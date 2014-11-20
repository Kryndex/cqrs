var eventstore = require("eventstore"),
    Repository = require("./Repository"),
    co = require("co"),
    Actor = require("./Actor"),
    ActorListener = require("./ActorListener"),
    EventBus = require("./EventBus");


class Domain {

    constructor() {
        this.eventstore = eventstore();
        this.ActorClasses = {};
        this.repos = {};
        this.eventBus = new EventBus(this.eventstore, this.repos);

        var self = this;
        co(function*(){

            self.register(ActorListener);
            var repo = self.repos["ActorListener"];
            var actorListener = yield repo.get("ActorListenerId");
            if(!actorListener){
                actorListener = yield repo.create();
            }
            self.actorListener = actorListener;
            actorListener.actorRepos = self.repos;

            self.eventBus.on("*", function (evt) {

                if(evt.data.targetType === "ActorListener" ) return;

                actorListener.call("pub",{eventName:evt.data.targetType + "." + evt.data.targetId + ":" + evt.name, event:evt});
                actorListener.call("pub",{eventName:evt.data.targetType + "." + evt.data.targetId, event:evt});
                actorListener.call("pub",{eventName:evt.data.targetType + ":" + evt.name, event:evt});
                actorListener.call("pub",{eventName:"." + evt.data.targetId + ":" + evt.name, event:evt});
                actorListener.call("pub",{eventName:":" + evt.name, event:evt});
                actorListener.call("pub",{eventName:evt.data.targetType, event:evt});

                if (evt.contextId) {
                    actorListener.call("pub",{eventName:evt.data.targetType + "." + evt.data.targetId + ":" + evt.name + "&" + evt.contextId, event:evt});
                    actorListener.call("pub",{eventName:evt.data.targetType + "." + evt.data.targetId + "&" + evt.contextId, event:evt});
                    actorListener.call("pub",{eventName:evt.data.targetType + ":" + evt.name + "&" + evt.contextId, event:evt});
                    actorListener.call("pub",{eventName:"." + evt.data.targetId + ":" + evt.name + "&" + evt.contextId, event:evt});
                    actorListener.call("pub",{eventName:":" + evt.name + "&" + evt.contextId, event:evt});
                    actorListener.call("pub",{eventName:evt.data.targetType + "&" + evt.contextId, event:evt});
                }
            })
        })();

        this.eventstore.init();
    }

    register(ActorClass) {

        var self = this;

        if (typeof ActorClass === "function") {
        } else {
            ActorClass = Actor.extend(arguments[0],arguments[1]);
        }
        this.ActorClasses[ActorClass.typeName] = ActorClass;

        var repo = new Repository(ActorClass, this.eventstore);
        this.repos[ActorClass.typeName] = repo;

        this._actorEventHandle(repo);

        return this;
    }

    _actorEventHandle(repo) {

        var self = this;

        function actorApplyEventHandle(actor) {
            self.eventBus.publish(actor);
        }

        function actorListenEventHandle(actor, eventName, handleMethodName, contextId, onlyContext) {

            self.actorListener.call("listen",{actor, eventName, handleMethodName, contextId, onlyContext});
        }

        function actorCallEventHandle(command) {
            self.call(command);
        }

        // listen actor
        let listenActorEventHandle = actor=> {

            actor.on("apply", actorApplyEventHandle);
            actor.on("listen", actorListenEventHandle);
            actor.on("call", actorCallEventHandle);

            if (actor.uncommittedEvents.length) {
                this.eventBus.publish(actor);
            }
        }

        repo.on("create", listenActorEventHandle);

        repo.on("reborn", listenActorEventHandle);
    }

    call(command, callback) {

        callback = callback || function () {}
        var self = this;

        co(function *() {
            try {
                var repo = self.repos[command.typeName];
                if(!repo){
                    throw new Error("please register "+command.typeName);
                }
                var actor = yield repo.get(command.actorId);
                if(!actor){
                    throw new Error("no find by id = "+command.actorId);
                }
                actor.call(command.methodName, command.data || {}, {}, command.contextId);
                callback();
            } catch (err) {
                callback(err);
            }
        })()
    }

    create(actorType, data, callback) {
        var repo = this.repos[actorType];
        co(function *() {
            try {
                var actor = yield repo.create(data);
                callback(null, actor.id);

            } catch (e) {
                callback(e);

            }
        })()

    }

    get(actorType, actorId, cb) {
        var self = this;
        co(function* () {
            try{
                var repo = self.repos[actorType];
                var actor = yield repo.get(actorId);
                cb(null,actor.json);
            }catch(e){
                cb(e);
            }
        })()
    }

    addListener(eventName, listener) {
        this.eventBus.on(eventName, listener);
    }

}

module.exports = Domain;