'use strict';

var _ = require('lodash');
var fs = require('fs');
var textureOverlay = require('./texture-overlay');
var Draggable = require('draggable');
var THREE = require('three');
var raf = require('raf');
var BRIGL = require('brigl');
var parts = require('parts');
var TimelineMax = require('timelinemax');
var TweenMax = require('tweenmax');
var TILE_SIZE = 256;
var ZOOM_MAX = 19;
var ZOOM_MIN = 14;
var ZOOM_DEFAULT = 17;
var Brickmarks = require('../../lib/brickmarks');
var canvasUtils = require('../../lib/canvas-utils');
var MinifigTool = require('./minifig-tool');
var HeroPlace = require('./hero-place');
var Vue = require('vue');
var sv;
var detector = require('../../lib/detector');
//var request = require('superagent');

var builder = new BRIGL.Builder('/parts/ldraw/', parts, {
  dontUseSubfolders: true
});

module.exports = {
  replace: true,
  template: fs.readFileSync(__dirname + '/template.html', 'utf8'),

  mixins: [
    require('vue-mediator-mixin')
  ],

  events: {

  },

  data: function() {
    return {
      locationTitle: '',
      minifigDraggable: false,
      uiVisible: true
    };
  },

  created: function(){
    this.size = {w: window.innerWidth, h: window.innerHeight};
  },

  compiled: function() {

    this.init3D();

    this.initLoader();
    //TweenMax.delayedCall(3, this.showLoader.bind(this));

    this.initMinifig();
    this.initTargetCircle();

    _.bindAll(this,
      'onPreload',
      'onStartDragMinifig',
      'onEndDragMinifig',
      'onDragMinifig',
      'drawStreetViewTileToCanvas',
      'render',
      'onZoomChanged',
      'onResize',
      'loadingTransitionDone',
      'onTilesLoaded',
      'onPlaceChanged',
      'onFindLocation',
      'onZoomIn',
      'onZoomOut',
      'onSearchBarFocus',
      'onSearchBarBlur',
      'submitCurrentSearch',
      'onLocationUpdated',
      'onModalOpen',
      'onModalClose',
      'submitCurrentSearch'
    );

    this.sub('routePreload:map', this.onPreload);
    this.sub('controls:findLocation', this.onFindLocation);
    this.sub('controls:zoomIn', this.onZoomIn);
    this.sub('controls:zoomOut', this.onZoomOut);
    this.sub('searchBar:focus', this.onSearchBarFocus);
    this.sub('searchBar:blur', this.onSearchBarBlur);
    this.sub('location:updated', this.onLocationUpdated);
    this.sub('modal:open', this.onModalOpen);
    this.sub('modal:close', this.onModalClose);
    this.sub('search:submit', this.submitCurrentSearch);

  },

  attached: function() {

    if (this.initCompleted && this.minifigDraggingInstance) {

      Vue.nextTick(function() {

        this.start();
        this.backToIdle();

        Vue.nextTick(function() {
          this.addMapEvents();
        }.bind(this));

      }.bind(this));


      google.maps.event.trigger(this.map, 'resize');
    }

    window.addEventListener('resize', this.onResize);

  },

  detached: function() {
    this.isRunning = false;
    if (this.rafId) {
      raf.cancel(this.rafId);
      this.rafId = undefined;
    }

    this.removeMarkers();

    this.scene.remove(this.loaderMesh);

    this.removeMapEvents();

    window.removeEventListener('resize', this.onResize);
  },

  ready: function() {

    this.gmapContainerEl = document.querySelector('.CustomGMap-container');
    this.gmapContainerWrapperEl = document.querySelector('.CustomGMap');
    this.minifigEl = document.querySelector('.CustomGMap-minifig');
    this.minifigCircleEl = document.querySelector('.CustomGMap-minifig-circle');
    this.threeEl = document.querySelector('.CustomGMap-three');
    this.bubbleEl = document.querySelector('.CustomGMap-bubble');

    this.markers = [];
    this.parkMeshes = [];
    this.initMap();
    this.heroPlace = new HeroPlace(this.map, builder, this.scene, this.camera);
    this.initStreetViewCoverageCanvas();

    this.updateLocationPresets();

    //add pegs to google maps
    textureOverlay.init({
      el: document.querySelector('.CustomGMap-overlay'),
      map: this.map
    });

    //wire buttons


    //flags and variables

    this.isTilesLoaded = false;
    this.mouse2d = new THREE.Vector2();
    this.frameTime = 0;

    //flags
    this.markersDirty = true;
    this.isOverRoad = false;
    this.isDragging = false;
    this.threeEl.appendChild(this.renderer.domElement);

    //minifig draggin instance
    this.minifigDraggingInstance = Draggable.create(this.minifigEl, {
      type: 'x,y',
      edgeResistance: 0.5,
      throwProps: true,
      bounds: window,
      onDragStart: this.onStartDragMinifig,
      onDragEnd: this.onEndDragMinifig,
      onDrag: this.onDragMinifig
    })[0];

    Vue.nextTick(function() {
      this.start();
      this.addMapEvents();
    }.bind(this));


    TweenMax.delayedCall(2, this.showMinifig);

  },

  methods: {

    initMap: function() {
      sv = new google.maps.StreetViewService();

      this.geocoder = new google.maps.Geocoder();

      var queryData = this.getQueryData();

      var myOptions = {
        zoom: queryData.zoom,
        minZoom: ZOOM_MIN,
        maxZoom: ZOOM_MAX,
        center: queryData.latLng,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        tilt: 0,
        disableDefaultUI: true,
        streetViewControl: false,
        styles: require('./gmap-styles'),
        scrollwheel: true
      };

      this.map = new google.maps.Map(this.gmapContainerEl, myOptions);
      this.currentZoom = queryData.zoom;

      this.streetViewLayer = new google.maps.StreetViewCoverageLayer();

      this.mapOverlay = new google.maps.OverlayView();
      this.mapOverlay.draw = function() {

      };
      this.mapOverlay.setMap(this.map);
    },

    addMapEvents: function() {

      this.searchEl = document.querySelector('.SearchBar-input');
      this.autocomplete = new google.maps.places.Autocomplete(this.searchEl);
      //this.autocomplete.bindTo('bounds', this.map);

      google.maps.event.addListener(this.autocomplete, 'place_changed', this.onPlaceChanged);
      google.maps.event.addListener(this.map, 'zoom_changed', this.onZoomChanged);
      google.maps.event.addListener(this.map, 'tilesloaded', this.onTilesLoaded);
      google.maps.event.addListener(this.map, 'drag', function() {
        this.markersDirty = true;
      }.bind(this));

      //used to update position
      google.maps.event.addListener(this.map, 'center_changed', _.debounce(function() {
        if (this.isRunning) {
          this.updateLocationTitle();
          this.updateUrl();
        }
      }.bind(this), 1000));

      textureOverlay.addListeners();
    },

    updateUrl: function() {
      Vue.navigate('/map/@' + this.map.getCenter().toUrlValue() + ',' + this.map.getZoom(), false);
    },

    updateLocationTitle: function() {

      this.locationTitle = '';
      var city = '';
      var country = '';

      this.geocoder.geocode({'latLng': this.map.getCenter()}, function(results, status) {
        if (status === google.maps.GeocoderStatus.OK) {

          for (var i = 0; i < results.length; i++) {

            for (var j = 0; j < results[i].types.length; j++) {

              if (results[i].types[j] === 'locality') {
                if (results[i].address_components[0]) {
                  city = results[i].address_components[0].long_name;
                }
              }

              if (results[i].types[j] === 'country') {
                country = results[i].address_components[0].long_name;
              }
            }

            if (city.length > 0 && country > 0) {
              break;
            }

          }

          this.locationTitle = city + ((country !== '' && country !== city) ? (', ' + country) : '');
        }
      }.bind(this));
    },

    removeMapEvents: function() {

      google.maps.event.clearInstanceListeners(this.autocomplete);
      //google.maps.event.clearListeners(this.map, 'zoom_changed');
      google.maps.event.clearListeners(this.map, 'tilesloaded');
      google.maps.event.clearListeners(this.map, 'center_changed');
      google.maps.event.clearListeners(this.map, 'drag');

      textureOverlay.removeListeners();
    },

    getQueryData: function() {
      var latLng = Brickmarks.getRandomLocation();// new google.maps.LatLng(40.749911, -73.981673);
      var coords = this.$parent.$data.$routeParams.coords;
      var zoom = ZOOM_DEFAULT;

      if (coords && coords.charAt(0) === '@') {
        var cols = coords.substring(1, coords.length).split(',');
        latLng = new google.maps.LatLng(Number(cols[0]), Number(cols[1]));

        if (cols[2]) {
          zoom = Number(cols[2]);
        }
      }

      return {
        latLng: latLng,
        zoom: zoom
      };

    },

    onLocationUpdated: function() {
      if (this.map) {
        var data = this.getQueryData();
        this.map.setCenter(data.latLng);
        this.map.setZoom(data.zoom);
        this.updateLocationPresets();
      }
    },

    initStreetViewCoverageCanvas: function() {

      this.streetviewCanvas = document.createElement('canvas');
      this.streetviewCanvas.width = 256;
      this.streetviewCanvas.height = 256;
      this.streetViewTileData = null;
      this.isLoadingStreetview = false;

      this.streetviewTileImg = document.createElement('img');
      this.streetviewTileImg.addEventListener('load', this.drawStreetViewTileToCanvas);

    },

    onPreload: function() {

      var self = this;

      Vue.nextTick(function() {

        //this.minifigDraggable = true;
        this.initCompleted = true;

        this.$dispatch('load-complete');

        if (this.isTilesLoaded) {
          this.$dispatch('init-complete');
        }
        else {
          this.$once('tilesLoaded', function() {
            self.$dispatch('init-complete');
          });
        }

      }, this);
    },

    onTilesLoaded: function() {

      this.isTilesLoaded = true;
      this.$emit('tilesLoaded');
    },

    onPlaceChanged: function() {
      var place = this.autocomplete.getPlace();
      if (place.geometry && place.geometry.viewport) {
        ga('send', 'event', 'search', 'input');
        this.map.fitBounds(place.geometry.viewport);
        this.map.setZoom(ZOOM_DEFAULT);
        this.updateLocationPresets();
      }
      else {
        this.submitCurrentSearch();
      }

    },

    submitCurrentSearch: function() {
      var self = this;
      var firstResult = this.searchEl.value;

      ga('send', 'event', 'search', 'input');

      this.geocoder.geocode({'address': firstResult}, function(results, status) {
        if (status === google.maps.GeocoderStatus.OK) {
          self.map.setCenter(results[0].geometry.location);
          self.updateLocationPresets();

        }
      });
    },

    onFindLocation: function() {

      var self = this;

      ga('send', 'event', 'search', 'currentLocation');

      if (navigator.geolocation) {

        self.minifigTool.show('mag');

        navigator.geolocation.getCurrentPosition(function(position) {
          var pos = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
          self.map.setCenter(pos);
          self.minifigTool.hide('mag');
          self.updateLocationPresets();
        }, function() {
          self.shakeHead();
        });
      }
      else {
        // Browser doesn't support Geolocation
        self.shakeHead();
      }

    },

    onSearchBarFocus: function() {
      this.minifigTool.show('mag');
    },

    onSearchBarBlur: function() {
      this.minifigTool.hide('mag');
    },

    updateLocationPresets: function() {

      if (detector.browsers.lowPerformance()) {
        return;
      }

      this.heroPlace.checkLocation();

      if (this.parkMeshes.length === 0) {

        var loaded = 0;

        builder.loadModelByName('3470.dat', {
          drawLines: false,
          startColor: 2
        }, function(mesh) {
          mesh.scale.set(0.6, 0.6, 0.6);
          mesh.position.set(0, 0, 0);
          this.parkMeshes.push(mesh);
          loaded++;
          if (loaded === 2) {
            this.createMarkersWithMesh();
          }
        }.bind(this));

        builder.loadModelByName('6065.dat', {
          drawLines: false,
          startColor: 2
        }, function(mesh) {
          mesh.scale.set(0.6, 0.6, 0.6);
          mesh.position.set(0, 0, 0);
          this.parkMeshes.push(mesh);
          loaded++;
          if (loaded === 2) {
            this.createMarkersWithMesh();
          }
        }.bind(this));
      }
      else {
        this.createMarkersWithMesh();
      }

    },

    createMarkersWithMesh: function() {

      if (this.markers.length) {
        this.removeMarkers();
      }

      var request = {
        location: this.map.getCenter(),
        radius: '1500',
        query: 'park'
      };

      var service = new google.maps.places.PlacesService(this.map);
      service.textSearch(request, callback);

      var self = this;
      function callback(results, status) {

        if (status === google.maps.places.PlacesServiceStatus.OK) {
          var marker, place, clonedMesh;
          for (var i = 0; i < results.length; i++) {
            place = results[i];

            marker = new google.maps.Marker({
              position: place.geometry.location,
              map: self.map,
              title: 'park'
            });

            marker.visible = false;

            clonedMesh = self.parkMeshes[Math.floor(Math.random() * self.parkMeshes.length)].clone();//new THREE.Mesh(new THREE.SphereGeometry(10, 10, 10), new THREE.MeshBasicMaterial({color: 0xffffff}));
            clonedMesh.rotation.set(0, Math.random() * Math.PI, Math.PI);
            clonedMesh.castShadow = true;

            self.scene.add(clonedMesh);
            self.markers.push({
              marker: marker,
              mesh: clonedMesh
            });

            self.markersDirty = true;
          }
        }
      }
    },

    updateMarkers: function() {
      var item;

      if (detector.browsers.lowPerformance()) {
        return;
      }

      this.markersDirty = false;

      var proj = this.mapOverlay.getProjection();
      if (!proj) {
        return;
      }

      this.heroPlace.update(proj);

      var scale = this.map.getZoom() / 21 * 1.1;
      scale = Math.pow(scale, 4);

      for (var i = this.markers.length - 1; i >= 0; i--) {
        item = this.markers[i];

        var point = proj.fromLatLngToContainerPixel(item.marker.position);

        this.projectionVector.set((point.x - this.size.w * 0.5) / this.size.w * 2, (point.y - this.size.h * 0.5) / -this.size.h * 2, -0.5);
        this.projectionVector.unproject(this.camera);

        var dir = this.projectionVector.sub(this.camera.position).normalize();
        var distance = -this.camera.position.y / dir.y;
        var pos = this.camera.position.clone().add(dir.multiplyScalar(distance));

        item.mesh.position.x = pos.x;
        item.mesh.position.z = pos.z;

        item.mesh.scale.set(scale, scale, scale);

      }
    },

    removeMarkers: function() {
      while (this.markers.length > 0) {
        var marker = this.markers.splice(0, 1)[0];
        this.scene.remove(marker.mesh);
        marker = null;
      }
    },

    shakeHead: function() {
      var self = this;

      this.minifigShakingHead = true;
      var timeline = new TimelineMax({onComplete: function() {
        self.minifigShakingHead = false;
      }});

      timeline.append(TweenMax.to(this.minifigMesh.brigl.animatedMesh.head.rotation, 0.2, {y: Math.PI * 0.4}));
      timeline.append(TweenMax.to(this.minifigMesh.brigl.animatedMesh.head.rotation, 0.2, {y: Math.PI * -0.4, repeat: 3, yoyo: true}));
    },

    onZoomIn: function() {
      var currentZoomLevel = this.map.getZoom();
      if (currentZoomLevel < ZOOM_MAX) {
        this.map.setZoom(currentZoomLevel + 1);
      }
    },

    onZoomOut: function() {
      var currentZoomLevel = this.map.getZoom();
      if (currentZoomLevel > ZOOM_MIN) {
        this.map.setZoom(currentZoomLevel - 1);
      }
    },

    start: function() {
      this.isRunning = true;
      this.markersDirty = true;
      this.render();

      this.onResize();

      //this.updateUrl();
      this.updateLocationTitle();
    },

    onMouseMove: function(event) {
      this.mouse2d.x = (event.clientX / this.size.w) * 2 - 1;
      this.mouse2d.y = -(event.clientY / this.size.h) * 2 + 1;
    },

    onZoomChanged: function() {
      var dir = -1;
      var newZoom = this.map.getZoom();

      if (newZoom < ZOOM_MIN) {
        newZoom = ZOOM_MIN;
        this.map.setZoom(newZoom);
      }

      if (newZoom > ZOOM_MAX) {
        newZoom = ZOOM_MAX;
        this.map.setZoom(newZoom);
      }

      if (this.currentZoom !== newZoom) {
        if (this.currentZoom < newZoom) {
          dir = 1;
        }

        this.currentZoom = newZoom;

        var self = this;
        TweenMax.to(this.minifigPivot.position, 0.3, {y: 300 + dir * 70, onComplete: function() {
          TweenMax.to(self.minifigPivot.position, 2, {y: 300});
        }});

        this.markersDirty = true;
      }
    },

    init3D: function() {

      this.projectionVector = new THREE.Vector3();
      this.scene = new THREE.Scene();

      this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 3100);
      this.camera.position.y = 850;
      //this.camera.position.z = -20;
      this.camera.lookAt(this.scene.position);

      this.renderer = new THREE.WebGLRenderer({
        alpha: true
      });

      this.renderer.shadowMapEnabled = true;
      this.renderer.shadowMapSoft = true;

      this.renderer.setSize(window.innerWidth - 1, window.innerHeight - 1);

      this.gammaInput = true;
      this.gammaOutput = true;

      var light = new THREE.PointLight(0xffffff, 0.3);
      light.position.copy(this.camera.position);
      light.position.x = 250;
      light.position.y = 900;
      light.position.z = 250;
      this.scene.add(light);

      light = new THREE.DirectionalLight(0xffffff, 0.7);
      light.position.set(1400, 1000, 100);
      this.scene.add(light);

      light = new THREE.AmbientLight(0x222222, 0.2);
      this.scene.add(light);

      //shadows
      // spot
      light = new THREE.SpotLight( 0xffffff, 0.8 );
      light.position.copy(this.camera.position)//.add(-300,100,100);
      light.position.x = 300;
      light.castShadow = true;
      light.onlyShadow = true;
      light.shadowCameraNear = 200;
      light.shadowCameraFar = 5000;
      light.shadowCameraFov = 70;
      light.shadowBias = -0.00022;
      light.shadowDarkness = 0.5;
      light.shadowMapWidth = 1024;
      light.shadowMapHeight = 1024;
      light.shadowCameraVisible = false;
      this.scene.add(light);

      //shadows plane
      var material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.1
      });
      var geometry = new THREE.PlaneGeometry(4000, 4000, 10, 10);
      var plane = new THREE.Mesh(geometry, material);
      plane.rotation.x = Math.PI * -0.5;
      plane.castShadow = false;
      plane.receiveShadow = true;
      this.scene.add(plane);

      this.brickContainer = new THREE.Object3D();
      this.scene.add(this.brickContainer);

      //this.scene.overrideMaterial = new THREE.MeshPhongMaterial({vertexColors: THREE.VertexColors, color:0xffffff,shininess:80,wrapAround:true});

    },

    initLoader: function() {
      var self = this;

      this.previewCanvas = document.createElement('canvas');
      this.previewCanvas.width = 128;
      this.previewCanvas.height = 128;

      builder.loadModelByName('legoloader.ldr', {
        drawLines: false
      }, function(mesh) {

        var circleGeometry = new THREE.CircleGeometry(70, 12, 0, Math.PI * 0.5);
        circleGeometry.applyMatrix(new THREE.Matrix4().makeRotationY(Math.PI * 0.5).makeRotationX(Math.PI * 0.5));

        self.loadingMaterials = [];

        for (var i = 0; i < 4; i++) {

          var textureCanvas = document.createElement('canvas');
          textureCanvas.width = 128;
          textureCanvas.height = 128;

          var texture = new THREE.Texture(textureCanvas);

          self.loadingMaterials.push(new THREE.MeshLambertMaterial({color: 0xffffff, transparent: false, map: texture}));

          var circle = new THREE.Mesh(circleGeometry, self.loadingMaterials[i]);
          circle.position.set(-39, -1, 39);
          circle.rotation.y = Math.PI * 0.5;
          mesh.brigl.animatedMesh['part' + (i + 5)].add(circle);
        }

        self.loaderMesh = mesh;

      }, function(err) {
        console.log(err);
      });
    },

    loadPreview: function(id) {
      var self = this;

      this.currentPanoId = id;

      //load preview
      var img = new Image();
      img.crossOrigin = 'anonymous';

      var tileSize = 128;

      img.onload = function() {

        //original canvas

        var ctx = self.previewCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, tileSize, tileSize);

        canvasUtils.renderPreview(ctx, [{
          shape: 'brick',
          resolutionX: 4,
          resolutionY: 6,
          offset: [0, 0]
        }], tileSize, tileSize);

        for (var i = 0; i < 4; i++) {
          //rotated canvas
          var canvas = this.loadingMaterials[i].map.image;
          var rotCtx = canvas.getContext('2d');
          rotCtx.save();
          rotCtx.translate(tileSize * 0.5, tileSize * 0.5);
          rotCtx.rotate(i * Math.PI * 0.5);
          rotCtx.drawImage(self.previewCanvas, -tileSize / 2, -tileSize / 2, tileSize, tileSize);
          rotCtx.restore();

          this.loadingMaterials[i].map.needsUpdate = true;
        }

        self.showLoader();

      }.bind(this);
      img.src = 'https://maps.googleapis.com/maps/api/streetview?size=128x128&pano=' + id + '&fov=120&heading=0&pitch=25';
    },

    showLoader: function() {
      var self = this;
      var i = 0;

      Object.keys(this.loaderMesh.brigl.animatedMesh).map(function(key) {

        var part = self.loaderMesh.brigl.animatedMesh[key];

        i++;

        part.visible = false;
        part.initPos = part.position.clone();

        var toPos = part.position.clone();
        toPos.y -= 10;
        var fromPos = part.initPos.clone();

        if (i === 1) {
          fromPos.x = 300;
          fromPos.y = -1100;
          fromPos.z = -300;
        }
        else if (i === 2) {
          fromPos.x = -300;
          fromPos.y = -1100;
          fromPos.z = -300;
        }
        else if (i === 3) {
          fromPos.x = -300;
          fromPos.y = -1100;
          fromPos.z = 300;
        }
        else if (i === 4) {
          fromPos.x = 300;
          fromPos.y = -1100;
          fromPos.z = 300;
        }
        else {
          fromPos.multiplyScalar(10);
        }

        part.position.copy(fromPos);

        TweenMax.to(part.position, 1, {
          ease: Sine.easeOut,
          x: toPos.x,
          y: toPos.y,
          z: toPos.z,
          delay: (i > 4) ? 0.5 + i * 0.2 : 0 + i * 0.2,
          onStart: function(item) {
            item.visible = true;
            TweenMax.from(item.rotation, 1, {
              x: Math.PI * 2.2,
              y: Math.PI * 1,
              z: Math.PI * 0.5,
              ease: Sine.easeOut
            });

          },
          onStartParams: [part],
          onComplete: function(item, partIndex) {
            TweenMax.to(item.position, 0, {
              ease: Sine.easeIn,
              x: item.initPos.x,
              y: item.initPos.y,
              z: item.initPos.z
            });

            if (partIndex >= 8) {
              TweenMax.delayedCall(0.6, self.loadingTransitionDone);
            }
         },
         onCompleteParams: [part, i]
        });

        //mesh.brigl.animatedMesh[key].initPos = mesh.brigl.animatedMesh[key].position.clone();
      });

      this.loaderMesh.position.set(0, 100, 0);
      //this.loaderMesh.rotation.set(0, Math.PI * -0.5, Math.PI + 10 * Math.PI / 180);
      //mesh.scale.set(0.2, 0.2, 0.2);
      this.scene.add(this.loaderMesh);
    },

    loadingTransitionDone: function() {
      Vue.navigate('/streetview/' + this.currentPanoId);

      //this.pub('loader:show', );
    },

    initTargetCircle: function() {

      var self = this;

      this.circleContainer3D = new THREE.Object3D();
      this.scene.add(this.circleContainer3D);

      builder.loadModelByName('4073.dat', {
        startColor: 15,
        drawLines: false
      }, function(mesh) {
        var newMesh;
        var angle;
        var r = 50;
        for (var i = 0; i < 10; i++) {
          newMesh = mesh.clone();
          newMesh.scale.set(0.8, 0.8, 0.8);
          newMesh.rotation.set(Math.random(), Math.random(), Math.random());
          angle = (Math.PI * 2) / 10;

          var phi = angle * i;
          var cx = r * Math.cos(phi);
          var cy = r * Math.sin(phi);

          newMesh.position.set(cx, 0, cy);
          self.circleContainer3D.add(newMesh);
        }

      }, function(err) {
        console.log(err);
      });

    },

    updateTargetCircle: function() {

      var children = this.circleContainer3D.children;
      var r, i, angle;

      if (this.isLoadingStreetview) {
        this.circleContainer3D.position.set(-10000, 0, 0);

        for (i = 0; i < 10; i++) {
          children[i].rotation.z = Math.random()*Math.PI;
          children[i].rotation.x = Math.random()*Math.PI;
          children[i].rotation.y = Math.random()*Math.PI;
        }

        return;
        //this.circleContainer3D.position.x += (0 - this.circleContainer3D.position.x) * 0.5;
        //this.circleContainer3D.position.y += (0 - this.circleContainer3D.position.y) * 0.5;
        //this.circleContainer3D.position.z += (0 - this.circleContainer3D.position.z) * 0.5;
      }
      else if (!this.isDragging) {
        //this.circleContainer3D.position.set(-10000, 0, 0);
        this.circleContainer3D.rotation.y += 0.01;
        this.circleContainer3D.position.x += (0 - this.circleContainer3D.position.x) * 0.5;
        this.circleContainer3D.position.y += (0 - this.circleContainer3D.position.y) * 0.5;
        this.circleContainer3D.position.z += (0 - this.circleContainer3D.position.z) * 0.5;
        //return;
      }
      else {
        var pos = this.minifigPivot.position.clone();
        var dir = pos.clone().sub(this.camera.position).normalize();
        dir.multiplyScalar(500);
        this.circleContainer3D.position.copy(pos).add(dir);

        if (this.isOverRoad) {
          this.circleContainer3D.rotation.y += 0.02;
        }
      }

      for (i = 0; i < 10; i++) {

        /*if (this.isLoadingStreetview) {
          r = 90;
          children[i].rotation.x += (0 - children[i].rotation.x) * 0.3;
          children[i].rotation.y += (0 - children[i].rotation.y) * 0.3;
          children[i].rotation.z += (Math.PI - children[i].rotation.z) * 0.3;
        }
        else */
        if( !this.isDragging ) {
          r = 30;
          children[i].rotation.z += 0.005;
          children[i].rotation.x += 0.01;
          children[i].rotation.y += 0.01;
        }
        else if (this.isOverRoad) {

          r = 40;
          children[i].rotation.x += (0 - children[i].rotation.x) * 0.3;
          children[i].rotation.y += (0 - children[i].rotation.y) * 0.3;
          children[i].rotation.z += (Math.PI - children[i].rotation.z) * 0.3;
        } else {
          r = 50;
          children[i].rotation.z += 0.01 * i;
          children[i].rotation.x += 0.02;
          children[i].rotation.y += 0.02;
        }

        angle = (Math.PI * 2) / 10;

        var phi = angle * i;
        var cx = r * Math.cos(phi);
        var cy = r * Math.sin(phi);

        children[i].position.set(cx, 0, cy);
      }
    },


    initMinifig: function() {

      this.minifigDefaultPos = new THREE.Vector3(-36, 300, -22);

      this.minifigLocation = new google.maps.LatLng(0, 0);
      this.minifigDragY = 0;

      this.faceDecals = {};

      var self = this;
      //builder.loadModelFromLibrary("minifig.ldr", {drawLines: false}, function(mesh)

      builder.loadModelByName('minifig.ldr', {}, function(mesh) {

        //sjortcut to mesh
        self.minifigMesh = mesh;

        //move mesh so hand is center
        mesh.position.set(20, 0, -20);
        mesh.rotation.set(Math.PI * 0.5, 0, Math.PI * -0.5);

        var container = new THREE.Object3D();
        container.position.copy(self.minifigDefaultPos);
        self.minifigPivot = container;

        //var sphere = new THREE.Mesh(new THREE.SphereGeometry(6,6,6), new THREE.MeshBasicMaterial({color:0xff0000}));
        //container.add(sphere);

        container.add(mesh);
        self.scene.add(container);

        Object.keys(mesh.brigl.animatedMesh).map(function(key) {
          mesh.brigl.animatedMesh[key].initPos = mesh.brigl.animatedMesh[key].position.clone();
        });

        //swap material on head;
        var texture = THREE.ImageUtils.loadTexture('/images/face.png');
        texture.repeat.x = 3;
        texture.offset.x = -1;
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;

        self.faceDecals.idle = texture;

        texture = THREE.ImageUtils.loadTexture('/images/face-smile.png');
        texture.repeat.x = 3;
        texture.offset.x = -1;
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;

        self.faceDecals.smile = texture;

        var material = new THREE.MeshBasicMaterial({map: self.faceDecals.idle, transparent: true, side: THREE.DoubleSide});
        self.headMaterial = material;

        var decalMesh = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 14.5, 18, 8, 1), material);
        decalMesh.position.y = 12;
        decalMesh.scale.y = -1;
        mesh.brigl.animatedMesh.head.add(decalMesh);


        //add decal to torso
        texture = THREE.ImageUtils.loadTexture('/images/shirt.png');
        texture.minFilter = THREE.LinearFilter;
        material = new THREE.MeshPhongMaterial({map: texture, transparent: true, side: THREE.DoubleSide});
        var torsoDecalMesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(35, 30, 1, 1), material);
        torsoDecalMesh.position.y = 15;
        torsoDecalMesh.position.z = -11;
        torsoDecalMesh.rotation.x = Math.PI - 0.08;
        mesh.brigl.animatedMesh.torso.add(torsoDecalMesh);


        //initPositions
        mesh.brigl.animatedMesh.torso.position.z -= 800;
        mesh.brigl.animatedMesh.armL.position.z -= 800;
        mesh.brigl.animatedMesh.armR.position.z -= 800;

        mesh.brigl.animatedMesh.legs.position.set(-300, 60, -800);
        mesh.brigl.animatedMesh.head.position.set(300, 300, -800);
        mesh.brigl.animatedMesh.hair.position.set(300, -300, -800);

        mesh.brigl.animatedMesh.legs.rotation.z = 5.3;
        mesh.brigl.animatedMesh.head.rotation.z = 3.1;
        mesh.brigl.animatedMesh.hair.rotation.z = 0.7;

        self.minifigTool = new MinifigTool(self.minifigMesh);
        self.minifigTool.hideAll();

        self.updateSpeachBubblePosition();

      }, function(err) {
        console.log(err);
      });

    },

    showMinifig: function() {

      var self = this;
      var mesh = this.minifigMesh;

      TweenMax.to(mesh.brigl.animatedMesh.torso.position, 0.4, {z: mesh.brigl.animatedMesh.torso.position.z + 800});
      TweenMax.to(mesh.brigl.animatedMesh.armL.position, 0.4, {z: mesh.brigl.animatedMesh.armL.position.z + 800});
      TweenMax.to(mesh.brigl.animatedMesh.armR.position, 0.4, {z: mesh.brigl.animatedMesh.armR.position.z + 800});

      TweenMax.to(mesh.brigl.animatedMesh.legs.position, 0.4, {x: 0, y: 40, z: 0});
      TweenMax.to(mesh.brigl.animatedMesh.head.position, 0.4, {x: 0, y: -50, z: 0});
      TweenMax.to(mesh.brigl.animatedMesh.hair.position, 0.4, {x: 0, y: -70, z: 0});

      TweenMax.to(mesh.brigl.animatedMesh.legs.rotation, 0.4, {z: 0});
      TweenMax.to(mesh.brigl.animatedMesh.head.rotation, 0.4, {z: 0});
      TweenMax.to(mesh.brigl.animatedMesh.hair.rotation, 0.4, {z: 0});

      setTimeout(function() {

        TweenMax.to(mesh.brigl.animatedMesh.legs.position, 0.2, {
          delay: 0.4,
          y: mesh.brigl.animatedMesh.legs.initPos.y
        });
        TweenMax.to(mesh.brigl.animatedMesh.head.position, 0.2, {
          delay: 0.4,
          y: mesh.brigl.animatedMesh.head.initPos.y,
          onComplete: function() {

            self.updateSpeachBubblePosition();

            TweenMax.to(mesh.brigl.animatedMesh.head.rotation, 0.2, {y: 0.3, ease: Sine.easeOut});
            TweenMax.to(mesh.brigl.animatedMesh.head.rotation, 0.5, {delay: 0.2, y: -0.6, ease: Back.easeOut});

            TweenMax.to(mesh.brigl.animatedMesh.hair.rotation, 0.2, {y: 0.3, ease: Sine.easeOut});

            TweenMax.to(mesh.brigl.animatedMesh.hair.rotation, 0.5, {delay: 0.2, y: -0.6, ease: Back.easeOut});

            TweenMax.to(mesh.brigl.animatedMesh.armL.rotation, 0.5, {x: 0.6, ease: Back.easeInOut});
            TweenMax.to(mesh.brigl.animatedMesh.armR.rotation, 0.5, {x: -0.6, ease: Back.easeInOut});

            TweenMax.to(mesh.brigl.animatedMesh.legL.rotation, 0.5, {x: 0.6, ease: Back.easeInOut});
            TweenMax.to(mesh.brigl.animatedMesh.legR.rotation, 0.5, {x: -0.6, ease: Back.easeInOut});

            TweenMax.to(self.minifigPivot.rotation, 0.5, {x: Math.PI * 0.2, ease: Sine.easeInOut});

            self.startHandHint();

            self.minifigDraggable = true;

          }
        });

        TweenMax.to(mesh.brigl.animatedMesh.hair.position, 0.2, {
          delay: 0.4,
          y: mesh.brigl.animatedMesh.hair.initPos.y
        });



      }, 200);

    },

    startHandHint: function() {
      var tl = new TimelineMax({delay: 6, repeatDelay: 6, repeat: -1});
      tl.insert(TweenMax.to(this.minifigMesh.brigl.animatedMesh.armR.brigl.animatedMesh.handR.rotation, 0.3, {z: Math.PI * 0.3, yoyo: true, repeat: 1, repeatDelay: 0, ease: Sine.easeInOut}));
    },

    stopHandHint: function() {
      TweenMax.killTweensOf(this.minifigMesh.brigl.animatedMesh.armR.brigl.animatedMesh.handR.rotation);
    },

    //from directive
    onCircleOver: function() {
      var hand = this.minifigMesh.brigl.animatedMesh.armR.brigl.animatedMesh.handR;
      hand.position.set(-8.16, 17.8729, -10);
      hand.translateZ(-3);

      this.headMaterial.map = this.faceDecals.smile;

    },

    onCircleOut: function() {
      var hand = this.minifigMesh.brigl.animatedMesh.armR.brigl.animatedMesh.handR;
      var toPos = new THREE.Vector3(-8.16, 17.8729, -10);
      TweenMax.to(hand.position, 0.3, {x: toPos.x, y: toPos.y, z: toPos.z});

      this.headMaterial.map = this.faceDecals.idle;
    },

    onStartDragMinifig: function() {

      var self = this;

      TweenMax.to(this.minifigEl, 0.3, {opacity: 0});

      this.uiVisible = false;
      this.$parent.uiVisible = false;


      this.stopHandHint();
      this.minifigDraggable = false;
      this.isDragging = true;
      this.map.setOptions({scrollwheel: false});

      this.streetViewLayer.setMap(this.map);

      //animate mesh
      var subMeshes = this.minifigMesh.brigl.animatedMesh;

      //minifigTalk('Now drop me somewhere');

      TweenMax.to(subMeshes.legR.rotation, 0.3, {
        x: 0.5
      });

      TweenMax.to(this.minifigPivot.rotation, 0.5, {
        x: Math.PI * -0.1,
        y: Math.PI * -0.2,
        z: Math.PI * -0.7,
        ease: Sine.easeInOut,
        onComplete: function() {

          TweenMax.to(subMeshes.legL.rotation, 0.5, {
            delay: 0.2,
            x: -0.8,
            yoyo: true,
            repeat: -1,
            ease: Sine.easeInOut
          });
          TweenMax.to(subMeshes.legR.rotation, 0.5, {
            delay: 0.2,
            x: -0.7,
            yoyo: true,
            repeat: -1,
            ease: Sine.easeInOut
          });

          TweenMax.to(self.minifigPivot.rotation, 0.5, {
            z: Math.PI * -0.4,
            yoyo: true,
            repeat: -1,
            ease: Sine.easeInOut,
            onUpdate: function() {
              self.minifigPivot.rotation.y += 0.01;
            }
          });

        }
      });

      TweenMax.to(subMeshes.armR.rotation, 0.5, {
        x: -Math.PI * 0.8,
        ease: Back.easeInOut
      });

      TweenMax.to(this.minifigPivot.position, 0.4, {
        y: this.minifigDragY,
        ease: Back.easeOut
      });

    },

    onDragMinifig: function() {
      this.minifigDirty = true;
    },

    updateMinifigPosition: function() {

      this.minifigDirty = false;

      //calculate the long lat of the minifig
      var rect = this.minifigEl.getBoundingClientRect();
      var offset = {
          top: rect.top + document.body.scrollTop,
          left: rect.left + document.body.scrollLeft
        },
        bounds = this.map.getBounds(),
        neLatlng = bounds.getNorthEast(),
        swLatlng = bounds.getSouthWest(),
        startLat = neLatlng.lat(),
        endLng = neLatlng.lng(),
        endLat = swLatlng.lat(),
        startLng = swLatlng.lng(),
        x = this.minifigDraggingInstance.pointerX,
        y = this.minifigDraggingInstance.pointerY;

      this.minifigLocation = new google.maps.LatLng(
        startLat + ((y / window.innerHeight) * (endLat - startLat)),
        startLng + ((x / window.innerWidth) * (endLng - startLng))
      );

      //place minifig in 3d
      this.projectionVector.set((x - this.size.w * 0.5) / this.size.w * 2, (y - this.size.h * 0.5) / -this.size.h * 2, -0.5);

      this.projectionVector.unproject(this.camera);
      var dir = this.projectionVector.sub(this.camera.position).normalize();
      var distance = -this.camera.position.y / dir.y;
      var pos = this.camera.position.clone().add(dir.multiplyScalar(distance));

      this.minifigPivot.position.x = pos.x;
      this.minifigPivot.position.z = pos.z;

      //calculate if over road
      var proj = this.map.getProjection();

      var numTiles = 1 << this.map.getZoom();
      var worldCoordinate = proj.fromLatLngToPoint(this.minifigLocation);

      var pixelCoordinate = new google.maps.Point(
        worldCoordinate.x * numTiles,
        worldCoordinate.y * numTiles);

      var tileCoordinate = new google.maps.Point(
        Math.floor(pixelCoordinate.x / TILE_SIZE),
        Math.floor(pixelCoordinate.y / TILE_SIZE));

      var localPixel = new google.maps.Point(pixelCoordinate.x % 256, pixelCoordinate.y % 256);

      var tileUrl = 'https://mts1.googleapis.com/vt?hl=sv-SE&lyrs=svv|cb_client:apiv3&style=40,18&x=' + tileCoordinate.x + '&y=' + tileCoordinate.y + '&z=' + this.map.getZoom();

      if (this.streetviewTileImg.src !== tileUrl) {
        this.streetviewTileImg.crossOrigin = '';
        this.streetviewTileImg.src = tileUrl;

      } else {
        if (this.streetViewTileData && this.streetViewTileData.length > 0) {
          //get pixel
          var index = (Math.floor(localPixel.y) * 256 + Math.floor(localPixel.x)) * 4;
          var trans = this.streetViewTileData[index];
          var blue = this.streetViewTileData[index - 1];
          var validColor = false;

          if (trans > 0 && blue === 132) {
            validColor = true;
          }

          if (validColor) {
            this.isOverRoad = true;
          } else if (!validColor) {
            this.isOverRoad = false;
          }
        }
      }
    },

    onEndDragMinifig: function() {

      var self = this;
      this.isDragging = false;
      this.isLoadingStreetview = true;
      this.headMaterial.map = this.faceDecals.idle;

      //_panoLoader.load(this.minifigLocation);
      this.streetViewLayer.setMap();

      sv.getPanoramaByLocation(this.minifigLocation, 50, function(data, status) {
        if (
          status === google.maps.StreetViewStatus.OK
          && data.links.length > 0
          && data.location.description !== 'Virtuo360'
          ) {
          /*
          position: data.location.latLng,

          title: data.location.description
          data.location.pano;*/
          console.log(data);

          /*request.withCredentials().get('http://maps.google.com/cbk?output=xml&ll='+ data.location.latLng.lat() + ',' + data.location.latLng.lng(), function(error, res) {
            if (error && error.status) {
              return;
            }
            else {
              console.log(res);
            }
          });
*/
          self.gotoStreetView(data);
           //self.backToIdle();

        } else {
          self.pub('loader:hide');
          self.backToIdle();

          TweenMax.delayedCall(1, function() {
            self.shakeHead();
          });
        }
      });
    },

    gotoStreetView: function(data) {

      var self = this;

      this.isLoadingStreetview = true;
      //this.isTilesLoaded = false;

      //this.gmapContainerWrapperEl.classList.add('tilted');
      this.minifigDraggingInstance.disable();

      this.removeMapEvents();

      //this.pub('loader:loadPano', data.location.pano);
      this.loadPreview(data.location.pano);

      var subMeshes = this.minifigMesh.brigl.animatedMesh;
      TweenMax.killTweensOf(this.minifigPivot.rotation);
      TweenMax.killTweensOf(subMeshes.legL.rotation);
      TweenMax.killTweensOf(subMeshes.legR.rotation);

      TweenMax.to(subMeshes.legL.rotation, 0.3, {x: 0, ease: Back.easeOut});
      TweenMax.to(subMeshes.legR.rotation, 0.3, {x: 0, ease: Back.easeOut});

      TweenMax.to(subMeshes.armR.rotation, 0.5, {
        x: 0, ease: Back.easeInOut
      });

      TweenMax.to(this.minifigPivot.rotation, 0.4, {
        x: 0,
        y: 0,
        z: Math.PI * -0.5
      });

      var pos = this.minifigPivot.position.clone();
      var dir = pos.clone().sub(this.camera.position).normalize();
      dir.multiplyScalar(600);
      pos.add(dir);

      TweenMax.to(this.minifigPivot.position, 0.2, {
        x: pos.x,
        y: pos.y - 50,
        z: pos.z + 40,
        onComplete: function() {
          TweenMax.to(self.minifigPivot.position, 0.8, {
            y: pos.y,
            ease: Bounce.easeOut,
            onComplete: function() {
            }
          });
        }
      });
    },

    backToIdle: function() {

      var self = this;

      TweenMax.to(this.minifigEl, 0.3, {opacity: 1});
      this.uiVisible = true;
      this.$parent.uiVisible = true;
      this.isLoadingStreetview = false;
      this.startHandHint();
      this.minifigDraggingInstance.enable();
      this.map.setOptions({scrollwheel: true});
      //remove streetview layer

      var subMeshes = this.minifigMesh.brigl.animatedMesh;
      TweenMax.killTweensOf(this.minifigPivot.rotation);
      TweenMax.killTweensOf(subMeshes.legL.rotation);
      TweenMax.killTweensOf(subMeshes.legR.rotation);

      TweenMax.to(subMeshes.legL.rotation, 0.3, {
        x: 0.6, ease: Back.easeOut
      });
      TweenMax.to(subMeshes.legR.rotation, 0.3, {
        x: -0.6, ease: Back.easeOut
      });

      TweenMax.to(this.minifigPivot.rotation, 0.4, {
        x: Math.PI * 0.2,
        z: 0,
        y: 0
      });
      TweenMax.to(this.minifigPivot.position, 0.4, {
        x: this.minifigDefaultPos.x,
        y: this.minifigDefaultPos.y,
        z: this.minifigDefaultPos.z,
        onComplete: function(){
          self.updateSpeachBubblePosition();
        }
      });


      TweenMax.to(this.minifigEl, 0.3, {
        opacity: 0,
        onComplete: function() {
          //self.gmapContainerWrapperEl.classList.remove('tilted');
          TweenMax.set(self.minifigEl, {
            x: 0,
            y: 0,
            onComplete: function() {

              self.minifigDraggable = true;

              TweenMax.to(self.minifigEl, 0.3, {
                opacity: 1
              });
              TweenMax.to(self.minifigMesh.brigl.animatedMesh.armR.rotation, 0.5, {
                x: -0.6,
                ease: Back.easeInOut
              });
            }
          });
        }
      });

    },

    render: function() {

      if (this.isRunning) {
        this.rafId = raf(this.render);
      }

      this.frameTime += 0.01;

      this.loaderMesh.rotation.x += (this.mouse2d.x * -0.5 - this.loaderMesh.rotation.x) * 0.3;
      this.loaderMesh.rotation.z += ((this.mouse2d.y * 0.5 + Math.PI) - this.loaderMesh.rotation.z) * 0.3;

      if (this.minifigDirty) {
        this.updateMinifigPosition();
      }

      if (this.minifigDraggable) {

        var toRot = -0.5 + this.mouse2d.x * -0.8;

        if (!this.minifigShakingHead) {
          this.minifigMesh.brigl.animatedMesh.head.rotation.y += (toRot - this.minifigMesh.brigl.animatedMesh.head.rotation.y) * 0.3;
        }

        this.minifigMesh.brigl.animatedMesh.hair.rotation.y += (this.minifigMesh.brigl.animatedMesh.head.rotation.y - this.minifigMesh.brigl.animatedMesh.hair.rotation.y) * 0.2;

        if (!this.minifigTool.activeTool) {
          this.minifigMesh.brigl.animatedMesh.armL.rotation.x += ((0.6 + Math.sin(this.frameTime) * 0.3 - 0.15) - this.minifigMesh.brigl.animatedMesh.armL.rotation.x) * 0.3;
        }

      }

      if (this.markersDirty) {
        this.updateMarkers();
      }

      this.updateTargetCircle();

      this.renderer.render(this.scene, this.camera);

    },

    onResize: function() {

      var w = window.innerWidth;
      var h = window.innerHeight;

      this.size.w = w;
      this.size.h = h;

      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();

      this.renderer.setSize(w, h);
      this.heroPlace.setSize(w, h);

      this.markersDirty = true;

      //head position
      this.updateSpeachBubblePosition();

    },

    updateSpeachBubblePosition: function(){
      if (this.bubbleEl) {
        var screenPos = this.toScreenPosition( this.minifigMesh.brigl.animatedMesh.head);
        TweenMax.set(this.bubbleEl,{x: screenPos.x + this.size.w / 2000 * 60, y: screenPos.y - this.size.w / 800 * 20, force3D:true});
      }
    },

    toScreenPosition: function(obj)
    {
      var vector = new THREE.Vector3();

      var widthHalf = 0.5*this.renderer.context.canvas.width;
      var heightHalf = 0.5*this.renderer.context.canvas.height;

      obj.updateMatrixWorld();
      vector.setFromMatrixPosition(obj.matrixWorld);
      vector.project(this.camera);

      vector.x = ( vector.x * widthHalf ) + widthHalf;
      vector.y = - ( vector.y * heightHalf ) + heightHalf;

      return {
          x: vector.x,
          y: vector.y
      };

    },

    onModalOpen: function() {

    },

    onModalClose: function() {

    },

    drawStreetViewTileToCanvas: function() {
      this.streetviewCanvas.width = this.streetviewCanvas.width;
      var ctx = this.streetviewCanvas.getContext('2d');

      ctx.drawImage(this.streetviewTileImg, 0, 0, 256, 256);
      this.streetViewTileData = ctx.getImageData(0, 0, 256, 256).data;
    }

  }
};
