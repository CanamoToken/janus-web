elation.require(['janusweb.janusbase'], function() {
  elation.component.add('engine.things.januslight', function() {
    this.postinit = function() {
      elation.engine.things.januslight.extendclass.postinit.call(this);
      this.defineProperties({
        light_directional: { type: 'bool', default: false, set: this.updateLight },
        light_range: { type: 'float', default: 0, set: this.updateLight, min: 0, comment: 'Max distance at which light can affect objects' },
        light_intensity: { type: 'float', default: 10, set: this.updateLight, comment: 'Light brightness' },
        light_cone_angle: { type: 'float', default: 0, set: this.updateLight, min: 0, max: 1, comment: 'Light cone shape. 0 = directional, 1 = point light, anything inbetween is a spotlight' },
        light_cone_exponent: { type: 'float', default: 1, set: this.updateLight },
        light_penumbra: { type: 'float', default: 1, set: this.updateLight, min: 0, max: 1, comment: 'Spotlight fall-off. 0 is crisp, 1 is smooth' },
        light_decay: { type: 'float', default: 2, set: this.updateLight, comment: 'The amount the light dims along the distance of the light. Default is 1. For physically correct lighting, set this to 2.' },
        light_target: { type: 'object', set: this.updateLightTarget },
        light_shadow: { type: 'boolean', default: false, set: this.updateLight, comment: 'Light casts shadows on scene' },
        light_shadow_near: { type: 'float', default: .1, set: this.updateLight },
        light_shadow_far: { type: 'float', set: this.updateLight },
        light_shadow_bias: { type: 'float', default: .0001, set: this.updateLight },
        light_shadow_radius: { type: 'float', default: 2.5, set: this.updateLight },
        light_helper: { type: 'boolean', default: false, set: this.updateLightHelper },
        collision_id: { type: 'string', default: 'sphere', set: this.updateCollider },
        collision_trigger: { type: 'boolean', default: true, set: this.updateCollider },
      });
    }
    this.createObject3D = function() {
      var obj = new THREE.Object3D();
      return obj;
    }
    this.updateColor = function() {
      this.updateLight();
    }
    this.createChildren = function() {
      elation.engine.things.januslight.extendclass.createChildren.call(this);

      this.createLight();
      this.updateLight();
      this.created = true;

      var scene = this.objects['3d'];
      while (scene.parent) {
        scene = scene.parent;
      }
      
      if (this.light_cone_angle == 0) {
        this.helper = new THREE.PointLightHelper(this.light);
      } else if (this.light_cone_angle == 1) {
        this.helper = new THREE.DirectionalLightHelper(this.light);
      } else {
        this.helper = new THREE.SpotLightHelper(this.light);
      }
      if (this.helper) {
        this.helper.traverse((n) => {
          n.layers.set(10);
        });
        scene.add(this.helper);
      }
      let placeholdergeo = this.getPlaceholderGeometry();
      if (placeholdergeo) {
        let placeholder = new THREE.Mesh(placeholdergeo, new THREE.MeshPhongMaterial({color: 0x666666, emissive: 0x333333, opacity: .8, transparent: true}));
        placeholder.layers.set(10);

        let collider = placeholder.clone();
        placeholder.userData.thing = this;
        collider.userData.thing = this;

        this.objects['3d'].add(placeholder);
        this.colliders.add(collider);
        this.placeholder = placeholder;
      }
    }
    this.getPlaceholderGeometry = function() {
      let placeholdergeo = null;
      if (this.light_cone_angle == 0) {
        placeholdergeo = new THREE.SphereBufferGeometry(.1);
      } else if (this.light_cone_angle == 1) {
        placeholdergeo = new THREE.SphereBufferGeometry(.1);
      } else {
        let angle = Math.acos(this.light_cone_angle),
            height = this.light_shadow_near,
            radius = Math.tan(angle) * height;
        placeholdergeo = new THREE.ConeBufferGeometry(radius, height);
        placeholdergeo.applyMatrix(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI/2, 0, 0)).setPosition(0, 0, height / 2));
      }
      return placeholdergeo;
    }
    this.update = function() {
      if (!this.light) {
        this.createLight();
        this.updateLight();
      }
      if (this.light && !this.light.parent) {
        this.objects['3d'].add(this.light);
      }
      if (this.helper) {
        this.helper.update();
      }
      if (this.light_directional || this.light_cone_angle == 1) {
        this.light.position.subVectors(this.light.position, this.light.target.position).add(player.pos);
        this.light.target.position.copy(player.pos);
      }
    }
    this.createLight = function() {
      if (!this.light) {
        if (this.light_directional || this.light_cone_angle == 1) {
          this.light = new THREE.DirectionalLight(this.properties.color, this.light_intensity);
          this.updateLightTarget();
        } else if (this.light_cone_angle == 0) {
          this.light = new THREE.PointLight(this.properties.color, 1, this.light_range);
          this.light.position.set(0,0,0);
        } else if (this.light_cone_angle > 0) {
          var angle = Math.acos(this.light_cone_angle);
          this.light = new THREE.SpotLight(this.properties.color, 1, this.light_range, angle, this.light_penumbra, this.light_decay);
          this.light.position.set(0,0,0);

          this.updateLightTarget();
        }
      }
    }
    this.updateLight = function() {
      if (this.light) {
        if (this.light.parent !== this.objects['3d']) {
          this.objects['3d'].add(this.light);
        }
        //this.light.intensity = this.light_intensity / 100;
        var avgscale = (this.scale.x + this.scale.y + this.scale.z) / 3;
        this.light.intensity = this.light_intensity / 100;
        this.light.penumbra = this.light_penumbra;
        this.light.decay = this.light_decay;
        this.light.color.copy(this.color);
        this.light.color.multiplyScalar(this.light_intensity * avgscale * avgscale);
        this.light.distance = this.light_range * avgscale;
        if (this.light_cone_angle > 0 && this.light_cone_angle < 1) {
          this.light.angle = Math.acos(this.light_cone_angle);
          if (this.placeholder) {
            this.placeholder.geometry = this.getPlaceholderGeometry();
          }
        }
        this.updateShadowmap();
      }
    }
    this.updateLightTarget = function() {
      if (!this.light) return;

      if (this.light_target) {
        if (elation.utils.isString(this.light_target)) {
          if (room.objects[this.light_target]) {
            let obj = room.objects[this.light_target];
            this.light.target = obj.objects['3d'];
          } else if (this.light_target == 'player') {
            this.light.target = player.objects['3d'];
          }
        } else if (this.light_target.objects && this.light_target.objects['3d']) {
          this.light.target = this.light_target.objects['3d'];
        } else if (this.light_target instanceof THREE.Object3D) {
          this.light.target = this.light_target;
        }
      }

      // If no target was specified, we're using the default, so make sure it's set up right
      var target = this.light.target;
      if (!target.parent) {
        this.objects['3d'].add(target);
        target.position.set(0,0,1);
      }
    }
    this.updateShadowmap = function() {
      var player = this.engine.client.player;
      var shadowSize = player.getSetting('render.shadows.size', elation.config.get('janusweb.materials.shadows.size', 512));

      this.light.castShadow = this.light_shadow;
      this.light.shadow.radius = this.light_shadow_radius;
      this.light.shadow.camera.near = elation.utils.any(this.light_shadow_near, 0.1);
      this.light.shadow.camera.far = elation.utils.any(this.light_shadow_far, this.light_range);
      this.light.shadow.camera.fov = 90;
      this.light.shadow.mapSize.set(shadowSize, shadowSize);
      this.light.shadow.bias = this.light_shadow_bias;

      // directional light shadow parameters
      let d = this.light_range;
      this.light.shadow.camera.left = -d;
      this.light.shadow.camera.right = d;
      this.light.shadow.camera.top = d;
      this.light.shadow.camera.bottom = -d;
    }
    this.getProxyObject = function(classdef) {
      if (!this._proxyobject) {
        this._proxyobject = elation.engine.things.janusobject.extendclass.getProxyObject.call(this, classdef);
        this._proxyobject._proxydefs = {
          light_range:         [ 'property', 'light_range'],
          light_intensity:     [ 'property', 'light_intensity'],
          light_cone_angle:    [ 'property', 'light_cone_angle'],
          light_cone_exponent: [ 'property', 'light_cone_exponent'],
          light_penumbra:      [ 'property', 'light_penumbra'],
          light_decay:         [ 'property', 'light_decay'],
          light_target:        [ 'property', 'light_target'],
          light_shadow:        [ 'property', 'light_shadow'],
          light_shadow_near:   [ 'property', 'light_shadow_near'],
          light_shadow_far:    [ 'property', 'light_shadow_far'],
          light_shadow_bias:   [ 'property', 'light_shadow_bias'],
          light_shadow_radius: [ 'property', 'light_shadow_radius'],
        };
      }
      return this._proxyobject;
    }
  }, elation.engine.things.janusbase);
});
