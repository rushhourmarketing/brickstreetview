'use strict';

require('gsap');

var fs = require('fs');
var debug = require('debug')('map');
var _ = require('lodash');

module.exports = {
  replace: true,
  template: fs.readFileSync(__dirname + '/template.html', 'utf8'),

  created: function() {

  },

  ready: function() {

    console.log('handle map loading here');
  },
  /*
  transitions: {
    landing: {
      leave: function(el, done) {
        var loadingBar = el.querySelector('.Landing-loadingBar');
        var avatar = el.querySelector('.Landing-avatar');

        var tl = new TimelineMax({
          paused: true,
          onComplete: done
        });

        tl.to(loadingBar, 0.3, {
          opacity: 0,
          y: -300
        });

        tl.to(avatar, 0.3, {
          opacity: 0,
          y: 300
        }, 0.1);

        tl.restart();

        return function() {
          tl.pause();
        };
      }
    }
  },
*/
  data: function() {
    return {
      title: 'Map'
    };
  },

  components: {
    'custom-gmap-component': require('../../components/custom-gmap')
  },

  methods: {

  },

  attached: function() {
    debug('attached');
  }
};
