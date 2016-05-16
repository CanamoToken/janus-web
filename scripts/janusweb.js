elation.require(['janusweb.config', 'engine.things.generic','janusweb.remoteplayer', 'janusweb.room', 'janusweb.tracking', 'janusweb.external.JanusClientConnection'], function() {
  elation.requireCSS('janusweb.janusweb');
  elation.component.add('engine.things.janusweb', function() {
    this.rooms = {};

    this.postinit = function() {
      this.defineProperties({
        url: { type: 'string', default: false },
        homepage: { type: 'string', default: "http://www.janusvr.com/index.html" },
        corsproxy: { type: 'string', default: '' },
        datapath: { type: 'string', default: '/media/janusweb' }
      });
      elation.events.add(window, 'popstate', elation.bind(this, this.handlePopstate));

      this.bookmarks = elation.collection.localindexed({index: 'url', storagekey: 'janusweb.bookmarks'});

      if (this.properties.corsproxy != '') {
        elation.engine.assets.setCORSProxy(this.properties.corsproxy);
      }
      elation.engine.assets.loadAssetPack(this.properties.datapath + 'assets.json');

      this.engine.systems.controls.addContext('janus', {
        'load_url': [ 'keyboard_tab', elation.bind(this, this.showLoadURL) ],
        'room_debug': [ 'keyboard_f6', elation.bind(this, this.showRoomDebug) ],
        'chat': [ 'keyboard_t', elation.bind(this, this.showChat) ],
        'bookmark': [ 'keyboard_ctrl_b', elation.bind(this, this.addBookmark) ]
      });
      this.engine.systems.controls.activateContext('janus');
      this.remotePlayers = {};
      this.lastUpdate = Date.now();
      this.tmpMat = new THREE.Matrix4();
      this.tmpVecX = new THREE.Vector3();
      this.tmpVecY = new THREE.Vector3();
      this.tmpVecZ = new THREE.Vector3();
      this.sentUpdates = 0;
      this.updateRate = 15;
      this.changes = {};

      if (this.engine.systems.admin) {
        elation.events.add(this.engine.systems.admin, 'admin_edit_change', elation.bind(this, this.handleRoomEditSelf));
      }
    }
    this.createChildren = function() {
      var hashargs = elation.url();
      var starturl = hashargs['janus.url'] || this.properties.url || this.properties.homepage;
      //setTimeout(elation.bind(this, this.load, starturl, true), 5000);
      this.load(starturl, true);
      // connect to presence server
      //this.userId = Date.now().toString();
      this.userId = this.getUsername();
      var host = elation.utils.any(hashargs['janus.server'], elation.config.get('janusweb.network.host')),
          port = elation.utils.any(hashargs['janus.port'], elation.config.get('janusweb.network.port'), 5567);
      var janusOptions = {
        host: host,
        port: port,
        userId: this.userId,
        version: '49.54',
        roomUrl: starturl
      }
      this.jcc = new JanusClientConnection(janusOptions);
      this.chat = elation.janusweb.chat({append: document.body, client: this.jcc, player: this.engine.client.player});
      this.jcc.addEventListener('message', function(msg) {
        this.onJanusMessage(msg);
      }.bind(this));
      this.jcc.addEventListener('connect', function() {
        this.sendPlayerUpdate({first: true});
        //elation.events.add(this.engine.client.player, 'thing_change', elation.bind(this, this.sendPlayerUpdate));
        setInterval(function() {
          this.sendPlayerUpdate({first: false});
        }.bind(this), 100);
        elation.events.fire({element: this, type: 'janusweb_client_connected', data: this.userId});
        this.chat.addmessage({userId: ' ! ', message: 'Connected as ' + this.userId });
      }.bind(this));
      elation.events.add(this, 'room_active', elation.bind(this, this.subscribe));
      elation.events.add(this, 'room_disable', elation.bind(this, this.unsubscribe));
    }
    this.clear = function() {
      if (this.currentroom) {
        this.remove(this.currentroom);
        //this.currentroom.die();
        //setTimeout(elation.bind(this.currentroom, this.currentroom.die), 1000);
        //this.currentroom.die();
        this.currentroom.disable();
        this.currentroom = false;
      }
      this.refresh();
    }
    this.load = function(url, makeactive) {
      var roomname = url;

      var room = this.spawn('janusroom', roomname, {
        url: url,
        janus: this
      });
      // FIXME - should be able to spawn without adding to the heirarchy yet
      this.remove(room);

      var roomid = md5(url);
      this.rooms[roomid] = room;
      console.log('made new room', url, room);
      this.loading = false;
      if (room && makeactive) {
        this.setActiveRoom(url);
      }
      return room;
    }
    this.setActiveRoom = function(url, pos) {
      this.clear();
      var changed = this.properties.url != url;
      if (!url) {
        url = this.properties.homepage || this.properties.url;
      } else {
        this.properties.url = url;
      }
      this.loading = true;

      var roomid = md5(url);
      if (this.rooms[roomid]) {
        if (this.currentroom !== this.rooms[roomid]) {
          this.currentroom = this.rooms[roomid];
          this.add(this.currentroom);
          this.currentroom.setActive();
          this.properties.url = url;
          this.loading = false;
          elation.events.fire({element: this, type: 'room_change', data: url});
        }
        if (!pos) pos = this.currentroom.playerstartposition;
        if (pos) {
          this.engine.client.player.properties.position.fromArray(pos);
          this.engine.client.player.properties.orientation.copy(this.currentroom.playerstartorientation);
console.log('set position!', pos, this.currentroom.playerstartorientation);
        }
        var hashargs = elation.url();
        if (url == this.properties.homepage) {
          delete hashargs['janus.url'];
        } else {
          hashargs['janus.url'] = url;
        }
        var newhash = '#' + elation.utils.encodeURLParams(hashargs);
        if (changed || document.location.hash != newhash) {
          document.location.hash = (newhash == '#' ? '' : newhash);
        }
        this.currentroom.enable();
      } else {
        this.load(url, true);
      }
    }
    this.handlePopstate = function(ev) {
      var hashargs = elation.url();
      var hashurl = hashargs['janus.url'];
      if (hashurl != this.properties.url && !this.loading) {
        this.setActiveRoom(hashurl);
      }
    }
    this.showLoadURL = function(ev) {
      if (ev.value == 1) {
        var url = prompt('url?');
        if (url) {
          elation.events.fire({element: this, type: 'janusweb_load_url', data: url});
          this.setActiveRoom(url, [0,0,0]);
        }
      }
    }
    this.showRoomDebug = function(ev) {
      if (ev.value == 1) {
        this.currentroom.showDebug();
      }
    }
    this.showChat = function(ev) {
      if (ev.value == 1) {
        this.chat.focus();
      }
    }
    this.addBookmark = function(ev) {
      if (ev.value == 1) {
        var room = {
          url: this.currentroom.properties.url, 
          title: this.currentroom.title,
          time: (new Date().getTime() / 1000)
        };
        this.bookmarks.add(room);
        elation.events.fire({type: 'janusweb_bookmark_add', element: this, data: room});
      }
    }
    this.subscribe = function(ev) {
      console.log('sub fired:', ev);
      this.jcc.subscribe(ev.data.properties.url);
      this.jcc.enter_room(ev.data.properties.url);
    }
    this.unsubscribe = function(ev) {
      console.log('unsub fired:', ev);
      this.jcc.unsubscribe(ev.data.properties.url);
    }
    this.onJanusMessage = function(msg) {
      var method = msg.data.method
      if (method == 'user_moved') {
        var userId = msg.data.data.position._userId;
        if (!this.remotePlayers.hasOwnProperty(userId)) {
          var remoteplayer = this.spawnRemotePlayer(msg.data.data);
          elation.events.fire({element: this, type: 'janusweb_user_joined', data: remoteplayer});
          this.chat.addmessage({userId: ' ! ', message: userId + ' entered room' });
        }
        else {
          this.moveRemotePlayer(msg.data.data);
        }
      }
      else if (method == 'user_disconnected' || method == 'user_leave') {
        var remoteplayer = this.remotePlayers[msg.data.data.userId];
        console.log("removing player", msg.data.data.userId, remoteplayer);
        elation.events.fire({element: this, type: 'janusweb_user_left', data: remoteplayer});
        this.chat.addmessage({userId: ' ! ', message: msg.data.data.userId + ' left room' });
        if (remoteplayer && remoteplayer.parent) {
          remoteplayer.die();
        }
        delete this.remotePlayers[msg.data.data.userId];
      } else if (method == 'user_portal') {
        var data = msg.data.data;
        var portalname = 'portal_' + data.userId + '_' + md5(data.url);
        var node = this.currentroom.parseNode(data);
        var room = this.rooms[data.roomId];
        if (room) {
          room.spawn('janusportal', portalname, {
            url: data.url,
            janus: this,
            room: room,
            title: data.url,
            position: node.pos,
            orientation: node.orientation,
          });
        }
      } else if (method == 'user_chat') {
        this.chat.addmessage(msg.data.data);
      }
    }
    this.getJanusOrientation = function(player, head) {
      // takes a quaternion, returns an object OTF {dir: "0 0 0", up_dir: "0 0 0", view_dir: "0 0 0"}
      this.tmpMat.makeRotationFromQuaternion(player.properties.orientation);
      this.tmpMat.extractBasis(this.tmpVecX, this.tmpVecY, this.tmpVecZ);
      var ret = {
        dir: this.tmpVecZ.clone().negate().toArray().join(' '),
        //up_dir: this.tmpVecY.toArray().join(' '),
        up_dir: '0 1 0',
        //view_dir: this.tmpVecZ.toArray().join(' ')
      }
      if (head) {
//console.log(head);
        //this.tmpMat.makeRotationFromQuaternion(head.properties.orientation);
        this.tmpMat.copy(head.objects['3d'].matrixWorld);
        this.tmpMat.extractBasis(this.tmpVecX, this.tmpVecY, this.tmpVecZ);
        ret.view_dir = this.tmpVecZ.clone().negate().toArray().join(' ');
        ret.up_dir = this.tmpVecY.toArray().join(' ');
        var headpos = head.properties.position.clone();//.sub(new THREE.Vector3(0,1.3,0));
        headpos.x *= -1;
        headpos.z *= -1;
        ret.head_pos = headpos.toArray().join(' '); //this.tmpMat.getPosition().toArray().join(' ');
      } else {
        ret.view_dir = '0 0 1';
        ret.head_pos = '0 0 0';
      }
//console.log(player, head);
      return ret;
    }
    this.spawnRemotePlayer = function(data) {
      var userId = data.position._userId;
      var spawnpos = (data.position.pos ? data.position.pos.split(" ").map(parseFloat) : [0,0,0]);
      this.remotePlayers[userId] = this.currentroom.spawn('remoteplayer', userId, { position: spawnpos, player_id: userId, player_name: userId});
      var remote = this.remotePlayers[userId];
      remote.janusDirs = {
        tmpVec1: new THREE.Vector3(),
        tmpVec2: new THREE.Vector3(),
        tmpVec3: new THREE.Vector3(),
        tmpMat4: new THREE.Matrix4()
      }
      return remote;
    }
    this.moveRemotePlayer = function(data) {
      var remote = this.remotePlayers[data.position._userId];
      var movedata = data.position;
      if (movedata.dir) {
        remote.janusDirs.tmpVec1.fromArray([0, 0, 0]);
        remote.janusDirs.tmpVec2.fromArray(movedata.dir.split(" "));
        remote.janusDirs.tmpVec3.fromArray([0,1,0]);
        remote.janusDirs.tmpMat4.lookAt(remote.janusDirs.tmpVec1, remote.janusDirs.tmpVec2, remote.janusDirs.tmpVec3);
      }

      if (movedata.view_dir && movedata.up_dir) {
        remote.janusDirs.tmpVec1.fromArray([0, 0, 0]);
        remote.janusDirs.tmpVec2.fromArray(movedata.view_dir.split(" "));
        remote.janusDirs.tmpVec3.fromArray(movedata.up_dir.split(" "));
        remote.janusDirs.tmpMat4.lookAt(remote.janusDirs.tmpVec1, remote.janusDirs.tmpVec2, remote.janusDirs.tmpVec3);
        if (remote.head) {
          remote.head.properties.orientation.setFromRotationMatrix(remote.janusDirs.tmpMat4);
          if (movedata.head_pos) {
            remote.head.properties.position.fromArray(movedata.head_pos.split(" "));
          }
        }
      }

      if (movedata.speaking && movedata.audio) {
        remote.speak(movedata.audio);
      }

      if (movedata.room_edit || movedata.room_delete) {
        this.handleRoomEditOther(data);
      }

      //remote.set('position', movepos, true);
      if (movedata.pos) {
        var movepos = movedata.pos.split(" ").map(parseFloat);
        remote.properties.position.fromArray(movepos);
      }
      remote.objects.dynamics.updateState();
      remote.refresh();
    }
    this.sendPlayerUpdate = function(opts) {
      // opts.first is a bool, if true then we are sending our avatar along with the move update
      // else, we send the avatar on every 15th update
      if (Date.now() - this.lastUpdate < 20) return;
      var player = this.engine.client.player;
      var dirs = this.getJanusOrientation(player, player.head)
      var moveData = {
        "pos": this.engine.client.player.properties.position.toArray().join(" "),
        "dir": dirs.dir,
        "up_dir": dirs.up_dir,
        "view_dir": dirs.view_dir,
        "head_pos": dirs.head_pos,
        "anim_id": "idle"
      }

      //console.log('movedata update', moveData);
      if (opts.first || this.sentUpdates == this.updateRate) {
        moveData["avatar"] = "<FireBoxRoom><Assets><AssetObject id=^jump^ src=^http://www.janusvr.com/avatars/animated/Beta/jump.fbx.gz^ /><AssetObject id=^fly^ src=^http://www.janusvr.com/avatars/animated/Beta/fly.fbx.gz^ /><AssetObject id=^speak^ src=^http://www.janusvr.com/avatars/animated/Beta/speak.fbx.gz^ /><AssetObject id=^walk^ src=^http://www.janusvr.com/avatars/animated/Beta/walk.fbx.gz^ /><AssetObject id=^type^ src=^http://www.janusvr.com/avatars/animated/Beta/type.fbx.gz^ /><AssetObject id=^portal^ src=^http://www.janusvr.com/avatars/animated/Beta/portal.fbx.gz^ /><AssetObject id=^run^ src=^http://www.janusvr.com/avatars/animated/Beta/run.fbx.gz^ /><AssetObject id=^idle^ src=^http://www.janusvr.com/avatars/animated/Beta/idle.fbx.gz^ /><AssetObject id=^body^ src=^http://www.janusvr.com/avatars/animated/Beta/Beta.fbx.gz^ /><AssetObject id=^walk_back^ src=^http://www.janusvr.com/avatars/animated/Beta/walk_back.fbx.gz^ /><AssetObject id=^walk_left^ src=^http://www.janusvr.com/avatars/animated/Beta/walk_left.fbx.gz^ /><AssetObject id=^walk_right^ src=^http://www.janusvr.com/avatars/animated/Beta/walk_right.fbx.gz^ /><AssetObject id=^head_id^ /></Assets><Room><Ghost id=^" + this.userId + "^ js_id=^105^ locked=^false^ onclick=^^ oncollision=^^ interp_time=^0.1^ pos=^0.632876 -1.204882 32.774837^ vel=^0 0 0^ accel=^0 0 0^ xdir=^0.993769 0 -0.111464^ ydir=^0 1 0^ zdir=^0.111464 0 0.993769^ scale=^0.0095 0.0095 0.0095^ col=^#a1e0c0^ lighting=^true^ visible=^true^ shader_id=^^ head_id=^head_id^ head_pos=^0 0 0^ body_id=^body^ anim_id=^^ anim_speed=^1^ eye_pos=^0 1.6 0^ eye_ipd=^0^ userid_pos=^0 0.5 0^ loop=^false^ gain=^1^ pitch=^1^ auto_play=^false^ cull_face=^back^ play_once=^false^ /></Room></FireBoxRoom>";
        this.sentUpdates = 0;
      }

      if (player.voipqueue && player.voipqueue.length > 0) {
        var binary = '';
        while (player.voipqueue.length > 0) {
          var buf = player.voipqueue.shift();
          var bytes = new Uint8Array(buf.buffer);
          for (var i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
        }
        moveData.speaking = true;
        moveData.audio = window.btoa(binary);
        moveData.anim_id = "speak";
      }
      var changeids = Object.keys(this.changes);
      var changestr = '';
      changeids.forEach(elation.bind(this, function(id) {
        changestr += this.changes[id];
        delete this.changes[id];
      }));
      if (changestr != '') {
        moveData.room_edit = changestr;
console.log(changestr);
      }
      if (document.activeElement && document.activeElement === this.chat.input.inputelement) {
        moveData.anim_id = 'type';
      }
      if (player.controlstate.run) {
        moveData.anim_id = 'run';
      } else if (player.controlstate.move_forward) {
        moveData.anim_id = 'walk';
      } else if (player.controlstate.move_left) {
        moveData.anim_id = 'walk_left';
      } else if (player.controlstate.move_right) {
        moveData.anim_id = 'walk_right';
      } else if (player.controlstate.move_backward) {
        moveData.anim_id = 'walk_back';
      }


      this.jcc.send({'method': 'move', 'data': moveData});
      this.lastUpdate = Date.now();
      this.sentUpdates++;
    }
    this.getUsername = function() {
      var adjectives = [
				"Adorable", "Beautiful", "Clean", "Drab", "Elegant", "Fancy", "Glamorous", "Handsome", "Long", "Magnificent",
				"Plain", "Quaint", "Sparkling", "Ugliest", "Unsightly", "Agreeable", "Brave", "Calm", "Delightful", "Eager",
				"Faithful", "Gentle", "Happy", "Jolly", "Kind", "Lively", "Nice", "Obedient", "Proud", "Relieved", "Silly",
				"Thankful", "Victorious", "Witty", "Zealous", "Angry", "Bewildered", "Clumsy", "Defeated", "Embarrassed",
				"Fierce", "Grumpy", "Helpless", "Itchy", "Jealous", "Lazy", "Mysterious", "Nervous", "Obnoxious", "Panicky",
				"Repulsive", "Scary", "Thoughtless", "Uptight", "Worried"
      ];
      var nouns = [
				"Alligator", "Ant", "Bear", "Bee", "Bird", "Camel", "Cat", "Cheetah", "Chicken", "Chimpanzee", "Cow",
				"Crocodile", "Deer", "Dog", "Dolphin", "Duck", "Eagle", "Elephant", "Fish", "Fly", "Fox", "Frog", "Giraffe",
				"Goat", "Goldfish", "Hamster", "Hippopotamus", "Horse", "Kangaroo", "Kitten", "Lion", "Lobster", "Monkey",
				"Octopus", "Owl", "Panda", "Pig", "Puppy", "Rabbit", "Rat", "Scorpion", "Seal", "Shark", "Sheep", "Snail",
				"Snake", "Spider", "Squirrel", "Tiger", "Turtle", "Wolf", "Zebra"
      ];

      var adj = adjectives[Math.floor(Math.random() * adjectives.length)];
      var noun = nouns[Math.floor(Math.random() * nouns.length)];
      var num = Math.floor(Math.random() * 1000);

      return adj + noun + num
    }
    this.handleRoomEditOther = function(data) {
      var roomId = data.roomId,
          movedata = data.position;
          edit = movedata.room_edit,
          del = movedata.room_delete;

      var room = this.rooms[roomId];
      if (room) {
        if (edit) {
          var editxml = edit.replace(/\^/g, '"');
          room.applyEditXML(editxml);
        }
        if (del) {
          var deletexml = del.replace(/\^/g, '"');
          room.applyDeleteXML(deletexml);
        }
      } 
    }
    this.handleRoomEditSelf = function(ev) {
      console.log('edited a thing', ev.data);
      var thing = ev.data;
      var change = thing.summarizeXML();
      if (thing.properties.js_id) {
        this.changes[thing.properties.js_id] = change;
      }
    }
  }, elation.engine.things.generic);
});
