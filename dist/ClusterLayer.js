define(["esri/layers/GraphicsLayer","esri/layers/FeatureLayer","esri/symbols/TextSymbol","esri/layers/support/LabelClass","esri/tasks/support/Query","esri/Graphic","esri/geometry/support/webMercatorUtils","esri/kernel","dojo/_base/declare","dojo/_base/lang","dojo/_base/array","dojo/on","dojo/has","require"],function(e,t,s,r,o,a,i,l,n,u,p,c,d,b){var f=parseFloat(l.version),h=1==d("esri-featurelayer-webgl"),y={type:"simple",symbol:{type:"simple-marker",style:"circle",size:10,color:[255,255,255,.6],outline:{width:1.5,color:"red",style:"solid"}},visualVariables:[{type:"size",field:"point_count",minDataValue:3,maxDataValue:1e3,minSize:{type:"size",valueExpression:"$view.scale",stops:[{value:1128,size:"20px"},{value:591657528,size:"12px"}]},maxSize:{type:"size",valueExpression:"$view.scale",stops:[{value:1128,size:"60px"},{value:288895,size:"50px"},{value:73957191,size:"40px"},{value:591657528,size:"12px"}]}}]},m=[{name:"objectid",alias:"Cluster ID in Local Index",type:"oid"},{name:"cluster_id",alias:"Cluster ID in Local Index",type:"long"},{name:"point_count",alias:"Total Points in Cluster Recorded",type:"long"},{name:"point_count_abbreviated",alias:"Total Points in Cluster (abbreviated)",type:"string"}],v={title:"Cluster Info",content:[{type:"fields",fieldInfos:[{fieldName:"cluster_id",label:"Cluster ID in Local Index",visible:!0},{fieldName:"point_count",label:"Total Points in Cluster",visible:!0},{fieldName:"point_count_abbreviated",label:"Total Points in Cluster (abbreviated)",visible:!0}]}]},w={type:"text",color:"black",haloColor:"blue",haloSize:"40px",text:"",xoffset:0,yoffset:"-4px",font:{size:"12px",family:"sans-serif",weight:"bolder"}},_=[new r({labelExpressionInfo:{expression:"$feature.point_count_abbreviated"},labelPlacement:"center-center",symbol:{type:"text",color:"black",font:{size:9,family:"sans-serif",weight:"normal"}}})];return t.createSubclass({properties:{clusterIndexReady:{},source_definitionExpression:{}},constructor:function(e){var t=this;for(var s in t.opts=e,t.featureLayerOpts={},t.worker=new Worker(b.toUrl("./ClusterWorker.js")),t.worker.onmessage=function(e){e.data.workerReady?t.worker.postMessage({supercluster:b.toUrl("./")+"../node_modules/supercluster/dist/supercluster.js"}):e.data.superclusterReady?(t.clusterWorkerReady=!0,t.view&&t.initClusterLayer()):e.data.indexReady?(t.clusterIndexReady=!0,t.requestClusters(!0)):t.displayClusters(e.data)},t.opts){var r=t.opts[s];"source_url"==s?t.featureLayerOpts.url=r:"source_definitionExpression"==s?t.featureLayerOpts.definitionExpression=r:"source_outFields"==s?t.featureLayerOpts.outFields=r:"supercluster"!=s&&"source"!=s&&"popupTemplate"!=s&&"renderer"!=s&&(t.featureLayerOpts[s]=r)}t.opts.supercluster||(t.opts.supercluster={}),t.currentFeatures=[],t.currentClusters=[],t.view=null,t.allViews=[],t.clusterFieldNames=p.map(m,function(e){return e.name});var i=t.opts.supercluster.fields||[];return t.opts.fields=m.concat(p.filter(i,function(e){return-1==t.clusterFieldNames.indexOf(e.name)})),t.opts.popupTemplate||(t.opts.popupTemplate=v),t.opts.labelsVisible&&4.9<=f&&!h&&(t.opts.labelWithGraphics=!0),t.opts.labelWithGraphics&&(t.opts.labelsVisible=!1),t.opts.labelsVisible&&!t.opts.labelingInfo&&(t.opts.labelingInfo=_),t.opts.labelsVisible&&!t.opts.labelingInfo&&(t.opts.labelingInfo=_),!t.opts.labelsVisible&&!t.opts.labelWithGraphics||t.opts.labelSymbol||(t.opts.labelSymbol=w),!t.opts.labelsVisible&&!t.opts.labelWithGraphics||t.opts.labelField||(t.opts.labelField="point_count_abbreviated"),t.opts.renderer||(t.opts.renderer=y),t.opts.geometryType="point",t.opts.spatialReference={wkid:4326},t.opts.objectIdField="objectid",t.opts.source&&(t.opts.source_features=t.opts.source),t.opts.source=[],t.inherited(arguments)},createLayerView:function(e){return this.view||(this.view=e),this.allViews.push(e),this.opts.labelWithGraphics&&this.enableLabelGraphics(),this.watchView(this.view),this.clusterWorkerReady&&this.initClusterLayer(),this.inherited(arguments)},destroyLayerView:function(e){return this.allViews.splice(this.allViews.indexOf(e),1),-1==this.allViews.indexOf(this.view)&&(0<this.allViews.length?this.view=this.allViews[0]:this.view=null),this.watchView(this.view),this.inherited(arguments)},enableLabelGraphics:function(){this.labelWithGraphics=!0,this.labelGraphics=new e({graphics:[],popupTemplate:this.popupTemplate}),this.view.map.add(this.labelGraphics),h&&(this.labelGraphics.opacity=0)},watchView:function(e){var t=this;t.stationaryWatch&&t.stationaryWatch.remove(),t.scaleWatch&&t.scaleWatch.remove(),e&&(t.stationaryWatch=t.view.watch("stationary",function(e){t.refreshClusters(e)}),t.scaleWatch=t.view.watch("scale",function(){t.labelGraphics&&h&&(t.labelGraphics.opacity=0)}))},initClusterLayer:function(e){var s=this;s.featureLayerOpts.url&&!s.featureLayerOpts.direct_url?(s.source_layer=new t(s.featureLayerOpts),s.source_layer.load().then(function(){s.source_definitionExpression=s.source_layer.definitionExpression,s.watch("source_definitionExpression",function(e,t){s.source_layer.definitionExpression=e,s.loadFeatures()}),s.loadFeatures()},function(e){console.log("Error: ",e)})):s.loadFeatures()},loadFeatures:function(e,t){var s=this,r=u.mixin({},s.opts.supercluster);if(r.fields&&delete r.fields,s.clusterIndexReady||s.worker.postMessage({opts:r}),s.opts.source_features){if(0<s.currentFeatures.length)return;s.worker.postMessage({features:s.opts.source_features,type:"esri",load:!0})}else if(s.opts.source_url&&s.featureLayerOpts.direct_url){if(0<s.currentFeatures.length)return;s.worker.postMessage({url:s.opts.source_url,load:!0,type:s.featureLayerOpts.direct_type||"geojson"})}else{e=e||s.source_layer.definitionExpression||"1=1",0==(t=t||0)&&(s.currentFeatures=[]);var i=p.filter(s.source_layer.outFields,function(e){return-1==s.clusterFieldNames.indexOf(e)});0==i.length&&(i=[s.source_layer.objectIdField]);var a=new o({num:s.source_layer.maxRecordCount||1e3,start:t,where:e,outFields:i,outSpatialReference:{wkid:4326},returnGeometry:!0}),l=function(e){s.worker.postMessage({features:e.features.map(x),type:"esri",load:!e.exceededTransferLimit}),e.exceededTransferLimit&&(a.start+=e.features.length,s.source_layer.queryFeatures(a).then(l))};s.source_layer.queryFeatures(a).then(l)}},requestClusters:function(){var e=this;if(e.requesting_clusters=!0,e.clusterIndexReady&&e.view){var t=parseInt(Math.round(e.view.zoom)),s=i.webMercatorToGeographic(t<5?e.view.map.basemap.baseLayers.items[0].fullExtent:e.view.extent);e.worker.postMessage({bbox:[s.xmin,s.ymin,s.xmax,s.ymax],zoom:t})}},refreshClusters:function(e){var t=this;t.view.popup.visible&&t.view.popup.selectedFeature&&(t.view.popup.selectedFeature.layer!=t&&t.view.popup.selectedFeature.layer!=t.labelGraphics||(t.view.popup.visible=!1)),e&&(t.requesting_clusters||t.requestClusters())},displayClusters:function(e){var r=this;function i(){r.source.removeAll(),r.source.addMany(r.currentClusters),r.addLabelGraphics(),r.requesting_clusters&&(r.requesting_clusters=!1)}r.currentClusters=p.map(e,function(e){var t=function(e){try{return new a({geometry:{type:"point",longitude:e.geometry.coordinates[0],latitude:e.geometry.coordinates[1]},attributes:e.properties})}catch(e){console.log("Error converting GeoJSON to Graphic:",e)}}(e);return t.attributes.point_count_abbreviated&&(t.attributes.point_count_abbreviated=t.attributes.point_count_abbreviated.toString()),r.opts.labelFormatter&&(t.attributes[r.opts.labelField]=r.opts.labelFormatter(t.attributes[r.opts.labelField])||t.attributes[r.opts.labelField]),t}),h&&4.9<=f?r.queryFeatures().then(function(e){var t=p.map(e.features,function(e){return{objectId:e.attributes.objectid}}),s={};0<r.currentClusters.length&&(s.addFeatures=r.currentClusters),0<t.length&&(s.deleteFeatures=t),r.applyEdits(s).then(function(e){r.addLabelGraphics(),r.requesting_clusters&&(r.requesting_clusters=!1)},function(){i()})},function(){i()}):i()},addLabelGraphics:function(){var t=this;t.labelGraphics&&(t.labelGraphics.removeAll(),t.labelGraphics.addMany(p.map(p.filter(t.currentClusters,function(e){return 0<e.attributes.point_count}),function(e){return new a({geometry:e.geometry,attributes:e.attributes,symbol:new s(u.mixin({},t.opts.labelSymbol,{text:e.attributes[t.opts.labelField]}))})})),h&&setTimeout(function(){t.labelGraphics.opacity=1},t.has_loaded?300:500),t.has_loaded=!0)}});function x(e){return e.toJSON()}});
//# sourceMappingURL=ClusterLayer.js.map