define([
  "esri/layers/GraphicsLayer",
  "esri/layers/FeatureLayer",
  "esri/symbols/TextSymbol",
  "esri/layers/support/LabelClass",
  "esri/tasks/support/Query",
  "esri/Graphic",
  "esri/geometry/support/webMercatorUtils",
  "esri/kernel",
  "dojo/_base/declare",
  "dojo/_base/lang",
  "dojo/_base/array",
  "dojo/on",
  "dojo/has",
  "require"
], function(
  GraphicsLayer,
  FeatureLayer,
  TextSymbol,
  LabelClass,
  Query,
  Graphic,
  webMercatorUtils,
  esriNS,
  declare,
  lang,
  array,
  on,
  has,
  require
){
  
  var esriVersion = parseFloat(esriNS.version);
  var isWebGL = has('esri-featurelayer-webgl')==1;
  
  var clusterRenderer = {
    type: "simple",
    symbol: {
      type: "simple-marker",
      style: "circle",
      size: 10,
      color: [255, 255, 255, 0.6],
      outline: {
        width: 1.5,
        color: "red",
        style: "solid"
      }
    },
    visualVariables: [{
      type: "size",
      field: "point_count",
      minDataValue: 3,
      maxDataValue: 1000,
      // minimum size to render minDataVal at specified view scales
      minSize: {
        type: "size",
        valueExpression: "$view.scale",
        stops: [
          { value: 1128,      size: "20px" },
          { value: 591657528, size: "12px" }
        ]
      },
      // maximum size to render maxDataVal at specified view scales
      maxSize: {
        type: "size",
        valueExpression: "$view.scale",
        stops: [
          { value: 1128,      size: "60px" },
          { value: 288895,    size: "50px" },
          { value: 73957191,  size: "40px" },
          { value: 591657528, size: "12px" }
        ]
      }
    }]
  };

  // Default cluster fields...these will always be added as attributes for the
  // features generated by th supercluster module.
  var clusterFields = [{
    name: "objectid",
    alias: "Cluster ID in Local Index",
    type: "oid"
  }, {
    name: "cluster_id",
    alias: "Cluster ID in Local Index",
    type: "long"
  }, {
    name: "point_count",
    alias: "Total Points in Cluster Recorded",
    type: "long"
  }, {
    name: "point_count_abbreviated",
    alias: "Total Points in Cluster (abbreviated)",
    type: "string"
  }];

  // A default cluster popup template...
  var clusterPopupTemplate = {
    title: "Cluster Info",
    content: [{
      type: "fields",
      fieldInfos: [{
        fieldName: "cluster_id",
        label: "Cluster ID in Local Index",
        visible: true
      }, {
        fieldName: "point_count",
        label: "Total Points in Cluster",
        visible: true
      }, {
        fieldName: "point_count_abbreviated",
        label: "Total Points in Cluster (abbreviated)",
        visible: true
      }]
    }]
  };

  var clusterLabelSymbol = {
    type: "text",
    color: "black",
    haloColor: "blue",
    haloSize: "40px",
    text: "",
    xoffset: 0,
    yoffset: "-4px",
    font: {
      size: "12px",
      family: "sans-serif",
      weight: "bolder"
    }
  }
  
  var clusterLabelingInfo = [new LabelClass({
      labelExpressionInfo: {
          expression: "$feature.point_count_abbreviated"
      },
      labelPlacement: "center-center",
      symbol: {
          type: "text",
          color: "black",
          font: {
              size: 9,
              family: "sans-serif",
              weight: "normal"
          }
      }
  })]

  return FeatureLayer.createSubclass({
    properties: {
      clusterIndexReady: {},
      source_definitionExpression: {}
    },
    
    constructor: function(opts){
      
      var $this = this;
      
      $this.opts = opts;
      $this.featureLayerOpts = {};
      
      $this.worker = new Worker(require.toUrl("./ClusterWorker.js"));
      $this.worker.onmessage = function(e) {
        if (e.data.workerReady) {
          // message received when the worker has loaded, but needs
          // a url to a script with the supercluster module.
          $this.worker.postMessage({
            supercluster: require.toUrl("./") + "../node_modules/supercluster/dist/supercluster.js"
          });
        } else if (e.data.superclusterReady) {
          // The supercluster module is now loaded in the worker.
          $this.clusterWorkerReady = true;
          // If the layer is already added to a map view, then  
          // call the initClusterLayer() method to get things started.
          if ($this.view) $this.initClusterLayer();
        } else if (e.data.indexReady) {
          // When the supercluster index is finished being 
          // prepared by the worker, we can start drawing the
          // clusters on the map.
          $this.clusterIndexReady = true;
          $this.requestClusters(true);
        } else {
          // This will be a message from the worker containing
          // clusters for the current zoom & extent.
          $this.displayClusters(e.data);
        }
      };
      

      for (var prop in $this.opts)
      {
        var val = $this.opts[prop];
        if (prop == "source_url")
          $this.featureLayerOpts.url = val;
        else if (prop == "source_definitionExpression")
          $this.featureLayerOpts.definitionExpression = val;
        else if (prop == "source_outFields")
          $this.featureLayerOpts.outFields = val;
        else if (prop != "supercluster" && prop != "source" && prop != "popupTemplate" && prop != "renderer")
          $this.featureLayerOpts[prop] = val;
      }
      
      if (!$this.opts.supercluster)
        $this.opts.supercluster = {};
      
      // This will store client-side features from the source feature layer:
      $this.currentFeatures = [];

      // This will store the graphics currently displayed in the main map view:
      $this.currentClusters = [];
      
      // Keep track of views that the map is displayed in.
      $this.view = null;
      $this.allViews = [];

      // For convenience later on, this will make it easy to distinguish
      // between client-side cluster attributes, and attributes associated with
      // the underlying feature service ...
      $this.clusterFieldNames = array.map(clusterFields, function(field) {
        return field.name;
      });

      // Any supercluster fields provided will be appended to the default
      // clusterFields.  They should be matched by any properties that are
      // defined/calculated by the supercluster initialize/map/reduce methods:
      var fields = $this.opts.supercluster.fields || [];
      $this.opts.fields = clusterFields.concat(array.filter(
        fields,
        function(field){
          return $this.clusterFieldNames.indexOf(field.name) == -1;
        }
      ));

      // If no supercluster popup template is provided, use a default template...
      if (!$this.opts.popupTemplate) $this.opts.popupTemplate = clusterPopupTemplate;
      
      if ($this.opts.labelsVisible && esriVersion >= 4.9 && !isWebGL) $this.opts.labelWithGraphics = true;
      if ($this.opts.labelWithGraphics) $this.opts.labelsVisible = false;
      
      
      if ($this.opts.labelsVisible && !$this.opts.labelingInfo)
        $this.opts.labelingInfo = clusterLabelingInfo;
      if ($this.opts.labelsVisible && !$this.opts.labelingInfo)
        $this.opts.labelingInfo = clusterLabelingInfo;
      if (($this.opts.labelsVisible || $this.opts.labelWithGraphics) && !$this.opts.labelSymbol)
        $this.opts.labelSymbol = clusterLabelSymbol;
      if (($this.opts.labelsVisible || $this.opts.labelWithGraphics) && !$this.opts.labelField)
        $this.opts.labelField = "point_count_abbreviated";

      // Renderer can be anything, but should define appropriate symbols based
      // on point_count, or any other attribute calculated by the SuperCluster
      // reduce() method.  Must be part of the supercluster parameters...
      if (!$this.opts.renderer) $this.opts.renderer = clusterRenderer;

      $this.opts.geometryType = "point";
      $this.opts.spatialReference = { wkid: 4326 };
      $this.opts.objectIdField = "objectid";
      
      // Stash local graphics if they are provided directly in the constructor options:
      if ($this.opts.source) $this.opts.source_features = $this.opts.source;
      
      $this.opts.source = [];

      return $this.inherited(arguments);
    },

    // The zoom level and extent used to define clustering will be based on the
    // first view that the layer is added to...
    createLayerView: function(mapView) {
      if (!this.view) this.view = mapView;
      this.allViews.push(mapView);

      if (this.opts.labelWithGraphics) {
        this.enableLabelGraphics();
      }
      
      this.watchView(this.view);

      if (this.clusterWorkerReady)
      {
        this.initClusterLayer();
      }

      return this.inherited(arguments);
    },
    
    // If the layer is removed from a view, switch to the next view (if the
    // layer has been added to more than one), or set this.view = null
    destroyLayerView: function(mapView) {
      this.allViews.splice(this.allViews.indexOf(mapView), 1);
      if (this.allViews.indexOf(this.view) == -1)
      {
        if (this.allViews.length > 0) this.view = this.allViews[0];
        else this.view = null;
      }
      
      this.watchView(this.view);
      
      return this.inherited(arguments);
    },
    
    enableLabelGraphics: function() {
      this.labelWithGraphics = true;
      this.labelGraphics = new GraphicsLayer({ graphics: [], popupTemplate: this.popupTemplate });
      this.view.map.add(this.labelGraphics);
      if (isWebGL) this.labelGraphics.opacity = 0;
    },
    
    watchView: function(mapView)
    {
      var $this = this;
      if ($this.stationaryWatch) $this.stationaryWatch.remove();
      if ($this.scaleWatch) $this.scaleWatch.remove();
      if (!mapView) return;
      $this.stationaryWatch = $this.view.watch("stationary", function(stationary){ $this.refreshClusters(stationary); });
      $this.scaleWatch = $this.view.watch("scale", function(){ 
        if ($this.labelGraphics && isWebGL) $this.labelGraphics.opacity = 0;
      });
    },

    initClusterLayer: function(e){
      var $this = this;
      if ($this.featureLayerOpts.url && !$this.featureLayerOpts.direct_url)
      {
        $this.source_layer = new FeatureLayer($this.featureLayerOpts);
        $this.source_layer.load().then(function(){
          $this.source_definitionExpression = $this.source_layer.definitionExpression;
          $this.watch("source_definitionExpression", function(newExp, oldExp) {
            $this.source_layer.definitionExpression = newExp;
            $this.loadFeatures();
          });

          $this.loadFeatures();
        }, function(e) {
          console.log("Error: ", e);
        });
      } else {
        $this.loadFeatures();
      }
    },

    loadFeatures: function(where, offset) {
      
      var $this = this;
      
      // Initialize the ClusterWorker if it hasn't been done yet...
      
      // Copy the supercluster options, remove the fields property (in 
      // case these have been defined as actual objects instead of simple
      // JSON data).
      var workerOpts = lang.mixin({}, $this.opts.supercluster);
      if (workerOpts.fields) delete workerOpts.fields;
      if (!$this.clusterIndexReady) $this.worker.postMessage({opts: workerOpts});
      
      // If $this was instantiated with client-side graphics, then just load
      // the supercluster index once...
      if ($this.opts.source_features)
      {
        if ($this.currentFeatures.length > 0) return;

        $this.worker.postMessage({
          features: $this.opts.source_features,
          type: "esri",
          load: true
        });

        return;
      }
      
      // If this was instantiated with url, and direct_url==true, then pass the URL to
      // the ClusterWorker, and let it load the URL as a raw JSON source...
      if ($this.opts.source_url && $this.featureLayerOpts.direct_url)
      {
        if ($this.currentFeatures.length > 0) return;
        
        // The direct_type can specify "esri" for an Esri FeatureSet JSON 
        // representation, "coords" for an array of
        // raw lon/lat pairs, or "geojson"...
        $this.worker.postMessage({
          url: $this.opts.source_url,
          load: true,
          type: $this.featureLayerOpts.direct_type || "geojson"
        });

        return;
      }
      
      // At this point, it is expected that a source_url parameter was provided which
      // should point to a layer in a FeatureServer.
      
      // Setup default parameters, and start querying the layer for features:
      where = where || $this.source_layer.definitionExpression || "1=1";
      offset = offset || 0;

      // If this is a new query, then initialize a new geojson features object
      if (offset == 0) $this.currentFeatures = [];

      // Get appropriate outFields to ask for when querying the underlying
      // feature layer...this must exclude the clusterFieldNames (which are
      // generated locally by the supercluster module)...
      var outFields = array.filter($this.source_layer.outFields, function(fieldname){
        return $this.clusterFieldNames.indexOf(fieldname) == -1;
      });

      if (outFields.length == 0) outFields = [$this.source_layer.objectIdField];

      // Define the query parameters...
      var query = new Query({
        num: $this.source_layer.maxRecordCount || 1000,
        start: offset,
        where: where,
        outFields: outFields,
        outSpatialReference: {wkid: 4326},
        returnGeometry: true
      });

      // Define a method in scope that will handle the query response...
      var handleQueryResponse = function(results){

        // Pass features to the cluster worker (as plain JSON).
        $this.worker.postMessage({
          features: results.features.map(esriObjectToJSON), 
          type: "esri", 
          load: !results.exceededTransferLimit
        });
        
        // Keep querying for more...
        if (results.exceededTransferLimit) {
          query.start += results.features.length;
          $this.source_layer.queryFeatures(query).then(handleQueryResponse);
        }
      };

      // Start querying the underlying layer for features...
      $this.source_layer.queryFeatures(query).then(handleQueryResponse);
    },

    requestClusters: function() {
      var $this = this;
      
      $this.requesting_clusters = true;
      
      if ($this.clusterIndexReady && $this.view) {

        var zoom = parseInt(Math.round($this.view.zoom));

        var extent = webMercatorUtils.webMercatorToGeographic(
          zoom < 5 ? $this.view.map.basemap.baseLayers.items[0].fullExtent : $this.view.extent
        );
        
        $this.worker.postMessage({bbox: [extent.xmin, extent.ymin, extent.xmax, extent.ymax], zoom: zoom});
      }
    },
    
    refreshClusters: function(stationary) {
      var $this = this;
      
      // Close the popup if it's showing details for a feature in this layer (or the labelGraphics layer).
      if ($this.view.popup.visible && $this.view.popup.selectedFeature)
      {
        if ($this.view.popup.selectedFeature.layer == $this || $this.view.popup.selectedFeature.layer == $this.labelGraphics)
        {
          $this.view.popup.visible = false;
        }
      }
      
      if (!stationary) return;
      
      // Only start refreshing the graphics if a request for clusters is not already in progress
      if (!$this.requesting_clusters) $this.requestClusters();
    },
    
    displayClusters: function(clusters) {
      
      var $this = this;
      
      $this.currentClusters = array.map(clusters, function(clusterGeoJson) {
        var cluster = graphicFromGeoJson(clusterGeoJson);
        
        // Ensure that the point_count_abbreviated attribute is always a string value, or it won't be
        // accepted when passed to the applyEdits method.
        if (cluster.attributes.point_count_abbreviated) 
          cluster.attributes.point_count_abbreviated = cluster.attributes.point_count_abbreviated.toString();
        
        if ($this.opts.labelFormatter)
          cluster.attributes[$this.opts.labelField] = $this.opts.labelFormatter(
            cluster.attributes[$this.opts.labelField]
          ) || cluster.attributes[$this.opts.labelField];
        
        return cluster;
      });
      
      if (isWebGL && esriVersion >= 4.9) {
        // As-of JSAPI 4.9, featurelayer-like object must have its graphics controlled
        // via the applyEdits method, even if it is being drawn from client-side graphics:
        $this.queryFeatures().then(function(result){
          var delete_ids = array.map(result.features, function(f){
            return {objectId: f.attributes.objectid};
          });
          
          var editFeatures = {};
          if ($this.currentClusters.length > 0) editFeatures.addFeatures = $this.currentClusters;
          if (delete_ids.length > 0) editFeatures.deleteFeatures = delete_ids;
          
          $this.applyEdits(editFeatures).then(function(edits){
            $this.addLabelGraphics();
            if ($this.requesting_clusters) $this.requesting_clusters = false;
          }, function(){
            addToSource();
          });
        }, function(){
          addToSource();
        });
      } else {
        addToSource();
      }
      
      function addToSource() {
        // JSAPI versions < 4.9 or 4.9 with WebGL disabled do not support 
        // queryFeatures/applyEdits on local graphics layers:
        $this.source.removeAll();
        $this.source.addMany($this.currentClusters);
        $this.addLabelGraphics();
        if ($this.requesting_clusters) $this.requesting_clusters = false;
      }
    },
    
    addLabelGraphics: function() {
      var $this = this;
      
      // Add any label graphics if enabled:
      if ($this.labelGraphics) { 
        $this.labelGraphics.removeAll();
        $this.labelGraphics.addMany(array.map(
          array.filter($this.currentClusters, function (cluster) {
            return cluster.attributes.point_count > 0;
          }), function(cluster) {
            var c = new Graphic({
              geometry: cluster.geometry,
              attributes: cluster.attributes,
              symbol: new TextSymbol(lang.mixin(
                {},
                $this.opts.labelSymbol,
                {text: cluster.attributes[$this.opts.labelField]}
              ))
            });
            return c;
          }
        ));
        
        // Since 4.9's switch to using WebGL drawing by default, there is a bit of lag 
        // when the cluster icons updated using applyEdits() are displayed on the map
        // relative to when label graphics appear after they are updated using the 
        // removeAll() and addMany() methods.  This timeout is added as a bit of
        // a hack to prevent the visual appearance of labels being drawn slightly before
        // the symobols for the points they represent...instead, they (usually) will
        // appear slightly after, which is somewhat less distracting.
        if (isWebGL) setTimeout(function(){
          $this.labelGraphics.opacity = 1;
        }, $this.has_loaded?300:500);
        
        $this.has_loaded = true;
      }
    }
  });
  
  function esriObjectToJSON(obj) {
    return obj.toJSON();
  }
  
  // Convert GeoJSON point objects to Esri Graphic objects:
  function graphicFromGeoJson(geoJson){
    try
    {
      return new Graphic(
        {
          geometry: {
            type: "point",
            longitude: geoJson.geometry.coordinates[0],
            latitude: geoJson.geometry.coordinates[1]
          },
          attributes: geoJson.properties
        }
      );
    } catch (e) {
      console.log('Error converting GeoJSON to Graphic:', e);
    }
  }
});
