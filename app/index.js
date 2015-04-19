'use strict';

var debug = require('debug');

var gmapsUtils = require('./lib/gmaps-utils');
var _ = require('lodash');

var Vue = require('vue');
Vue.use(require('vue-route'));
Vue.use(require('vue-once'));

require('./lib/gmaps-utils').configure({
  key: '',
  libraries: ['places']
});

if (process.env.NODE_ENV === 'production') {
  // Disable all debug logs in production.
  debug.disable();
  Vue.config.silent = true;
} else {
  // Enable debug log via query string.
  // Example: ?debug=url,route
  //
  // Here `route` is enabled by default.
  require('enable-debug')(['route'], true);

  Vue.config.debug = true;
}

// Statup the router.
new Vue({
  el: '#app',

  created: function() {
    _.bindAll(this, 'onLoadComplete', 'onInitComplete');
  },

  events: {
    'load-complete': 'onLoadComplete',
    'init-complete': 'onInitComplete'
  },

  mixins: [
    require('vue-mediator-mixin')
  ],

  routes: {
    '/about': {
      componentId: 'section-about',
      isDefault: false,
      beforeUpdate: function(currentCtx, prevCtx, next) {
        next();
      },
      afterUpdate: function(currentCtx, prevCtx) {
        this.pub('routePreload:about');
        this.showBackBtn = true;
        this.showPhotoShareBtn = false;

        if (prevCtx.path && prevCtx.path.indexOf('streetview') !== -1) {
          this.backButtonLabel = 'back';
        }
        else {
          this.backButtonLabel = 'map';
        }

      }
    },
    '/map': {
      componentId: 'section-map',
      isDefault: true,
      beforeUpdate: checkGMapsAPI,
      afterUpdate: function() {
        this.pub('routePreload:map');
        this.showBackBtn = false;
        this.showPhotoShareBtn = false;

        this.backButtonLabel = 'map';

      }
    },
    '/streetview': {
      componentId: 'section-streetview',
      isDefault: false,
      beforeUpdate: checkGMapsAPI,
      afterUpdate: function() {
        this.pub('routePreload:streetview');
        this.showBackBtn = true;
        this.showPhotoShareBtn = true;

        this.backButtonLabel = 'map';
      }
    },
    '/streetview/:panoid': {
      componentId: 'section-streetview',
      isDefault: false,
      beforeUpdate: checkGMapsAPI,
      afterUpdate: function() {
        this.pub('routePreload:streetview');
        this.showBackBtn = true;
        this.showPhotoShareBtn = true;
        //this.showSearchBar = false;

        this.backButtonLabel = 'map';
      }
    },
    options: {

    }
  },

  components: {
    'section-loader': require('./components/loader'),
    'top-menu-component': require('./components/top-menu'),
    'share-ui-component': require('./components/share-ui'),
    'back-button-component': require('./components/back-button'),
    'search-bar-component': require('./components/search-bar'),
    'section-about': require('./sections/about'),
    'section-map': require('./sections/map'),
    'section-streetview': require('./sections/streetview')
  },

  data: function() {
    return {
      showBackBtn: false,
      backButtonLabel: 'map'
    };
  },

  methods: {
    onLoadComplete: function() {

    },

    onInitComplete: function() {
      setTimeout( function() {
        this.pub('loader:hide');
      }.bind(this), 100);
    }
  }
});

var apiLoaded = false;

function checkGMapsAPI(currentCtx, prevCtx, next) {
  //console.log('beforeUpdate',this);

  this.pub('loader:show');

  setTimeout(function() {

    if (apiLoaded) {
      next();
    }
    else {

      apiLoaded = true;

      gmapsUtils.load(function() {
        next();
      });
    }
  }, 500);

}


