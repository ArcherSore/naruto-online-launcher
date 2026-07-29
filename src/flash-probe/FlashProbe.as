package {
  import flash.display.DisplayObject;
  import flash.display.DisplayObjectContainer;
  import flash.display.InteractiveObject;
  import flash.display.Sprite;
  import flash.events.Event;
  import flash.events.IOErrorEvent;
  import flash.events.ProgressEvent;
  import flash.events.SecurityErrorEvent;
  import flash.events.TimerEvent;
  import flash.net.Socket;
  import flash.system.Security;
  import flash.utils.ByteArray;
  import flash.utils.Timer;
  import flash.utils.getQualifiedClassName;

  /**
   * Minimal PreloadSwf research agent.
   *
   * Protocol: newline-delimited UTF-8 JSON over a loopback TCP socket.
   */
  public final class FlashProbe extends Sprite {
    private static const HOST:String = "127.0.0.1";
    private static const DEFAULT_PORT:int = 32145;
    private static const MAX_COMMAND_BYTES:int = 8192;
    private static const MAX_MESSAGE_BYTES:int = 1024 * 1024;
    private static const MAX_DEPTH:int = 5;
    private static const MAX_OBJECTS:int = 500;

    private var socket:Socket;
    private var receiveBuffer:String = "";
    private var connected:Boolean = false;
    private var port:int = DEFAULT_PORT;
    private var helloTimer:Timer;

    public function FlashProbe() {
      super();
      if (stage) {
        onStageReady();
      } else {
        addEventListener(Event.ADDED_TO_STAGE, onAddedToStage);
      }
    }

    private function onAddedToStage(event:Event):void {
      removeEventListener(Event.ADDED_TO_STAGE, onAddedToStage);
      onStageReady();
    }

    private function onStageReady():void {
      port = resolvePort();
      Security.loadPolicyFile("xmlsocket://" + HOST + ":" + port);
      socket = new Socket();
      socket.addEventListener(Event.CONNECT, onConnect);
      socket.addEventListener(Event.CLOSE, onClose);
      socket.addEventListener(ProgressEvent.SOCKET_DATA, onSocketData);
      socket.addEventListener(IOErrorEvent.IO_ERROR, onIoError);
      socket.addEventListener(SecurityErrorEvent.SECURITY_ERROR, onSecurityError);
      try {
        socket.connect(HOST, port);
      } catch (_:Error) {
        connected = false;
      }
    }

    private function onConnect(event:Event):void {
      connected = true;
      helloTimer = new Timer(250, 60);
      helloTimer.addEventListener(TimerEvent.TIMER, trySendHello);
      helloTimer.addEventListener(TimerEvent.TIMER_COMPLETE, sendFallbackHello);
      helloTimer.start();
      trySendHello();
    }

    private function onClose(event:Event):void {
      connected = false;
      stopHelloTimer();
    }

    private function onIoError(event:IOErrorEvent):void {
      connected = false;
      stopHelloTimer();
    }

    private function onSecurityError(event:SecurityErrorEvent):void {
      connected = false;
      stopHelloTimer();
    }

    private function resolvePort():int {
      try {
        var value:Number = Number(loaderInfo.parameters.port);
        if (!isNaN(value) && value >= 1024 && value <= 65535 && int(value) == value) {
          return int(value);
        }
      } catch (_:Error) {
        // Keep the fixed research-demo default.
      }
      return DEFAULT_PORT;
    }

    private function trySendHello(event:TimerEvent = null):void {
      var gameRoot:DisplayObject = findGameRoot();
      if (!gameRoot) return;
      stopHelloTimer();
      sendHello(gameRoot);
    }

    private function sendFallbackHello(event:TimerEvent):void {
      stopHelloTimer();
      sendHello(stage ? stage.root : null);
    }

    private function sendHello(gameRoot:DisplayObject):void {
      sendMessage({
        type: "hello",
        stageWidth: stage ? stage.stageWidth : 0,
        stageHeight: stage ? stage.stageHeight : 0,
        rootClass: gameRoot ? className(gameRoot) : ""
      });
    }

    private function findGameRoot():DisplayObject {
      if (!stage) return null;
      var agentRoot:DisplayObject = root;
      try {
        for (var i:int = 0; i < stage.numChildren; i++) {
          var candidate:DisplayObject = stage.getChildAt(i);
          if (candidate !== this && candidate !== agentRoot) return candidate;
        }
      } catch (_:Error) {
        return null;
      }
      return null;
    }

    private function stopHelloTimer():void {
      if (!helloTimer) return;
      helloTimer.stop();
      helloTimer.removeEventListener(TimerEvent.TIMER, trySendHello);
      helloTimer.removeEventListener(TimerEvent.TIMER_COMPLETE, sendFallbackHello);
      helloTimer = null;
    }

    private function onSocketData(event:ProgressEvent):void {
      if (!socket || socket.bytesAvailable <= 0) return;
      if (socket.bytesAvailable > MAX_COMMAND_BYTES) {
        socket.close();
        connected = false;
        return;
      }
      receiveBuffer += socket.readUTFBytes(socket.bytesAvailable);
      if (receiveBuffer.length > MAX_COMMAND_BYTES) {
        socket.close();
        connected = false;
        return;
      }

      var newline:int = receiveBuffer.indexOf("\n");
      while (newline >= 0) {
        var line:String = receiveBuffer.substring(0, newline);
        receiveBuffer = receiveBuffer.substring(newline + 1);
        if (line.length > 0 && line.charAt(line.length - 1) == "\r") {
          line = line.substring(0, line.length - 1);
        }
        if (line.length > 0) handleCommand(line);
        newline = receiveBuffer.indexOf("\n");
      }
    }

    private function handleCommand(line:String):void {
      var command:Object;
      try {
        command = JSON.parse(line);
      } catch (_:Error) {
        sendMessage({ type: "error", requestId: -1, code: "invalid-json" });
        return;
      }
      if (!command || command.type !== "snapshot" || !(command.requestId is Number)) {
        sendMessage({ type: "error", requestId: -1, code: "invalid-command" });
        return;
      }
      sendSnapshot(Number(command.requestId));
    }

    private function sendSnapshot(requestId:Number):void {
      var objects:Array = [];
      var state:Object = { count: 0, truncated: false };
      if (stage) enumerate(stage, 0, -1, objects, state);
      sendMessage({
        type: "snapshot",
        requestId: requestId,
        objects: objects,
        truncated: state.truncated === true
      });
    }

    private function enumerate(
      node:DisplayObject,
      depth:int,
      childIndex:int,
      output:Array,
      state:Object
    ):void {
      if (!node || state.count >= MAX_OBJECTS) {
        state.truncated = true;
        return;
      }

      output.push(describe(node, depth, childIndex));
      state.count++;
      if (depth >= MAX_DEPTH) return;

      var container:DisplayObjectContainer = node as DisplayObjectContainer;
      if (!container) return;
      var childCount:int;
      try {
        childCount = container.numChildren;
      } catch (_:Error) {
        return;
      }
      for (var i:int = 0; i < childCount; i++) {
        if (state.count >= MAX_OBJECTS) {
          state.truncated = true;
          return;
        }
        try {
          enumerate(container.getChildAt(i), depth + 1, i, output, state);
        } catch (_:Error) {
          // A hostile/transitioning DisplayList node must not abort the snapshot.
        }
      }
    }

    private function describe(node:DisplayObject, depth:int, childIndex:int):Object {
      var interactive:InteractiveObject = node as InteractiveObject;
      return {
        name: safeName(node),
        qualifiedClassName: className(node),
        x: safeNumber(function():Number { return node.x; }),
        y: safeNumber(function():Number { return node.y; }),
        width: safeNumber(function():Number { return node.width; }),
        height: safeNumber(function():Number { return node.height; }),
        visible: safeBoolean(function():Boolean { return node.visible; }),
        mouseEnabled: interactive
          ? safeBoolean(function():Boolean { return interactive.mouseEnabled; })
          : false,
        depth: depth,
        childIndex: childIndex
      };
    }

    private function safeName(node:DisplayObject):String {
      var result:String = "";
      try {
        result = node.name || "";
      } catch (_:Error) {
        // Keep the safe default.
      }
      return result;
    }

    private function className(value:Object):String {
      var result:String = "";
      try {
        result = getQualifiedClassName(value);
      } catch (_:Error) {
        // Keep the safe default.
      }
      return result;
    }

    private function safeNumber(reader:Function):Number {
      var result:Number = 0;
      try {
        var value:Number = Number(reader());
        result = isNaN(value) || !isFinite(value) ? 0 : value;
      } catch (_:Error) {
        // Keep the safe default.
      }
      return result;
    }

    private function safeBoolean(reader:Function):Boolean {
      var result:Boolean = false;
      try {
        result = reader() === true;
      } catch (_:Error) {
        // Keep the safe default.
      }
      return result;
    }

    private function sendMessage(message:Object):void {
      if (!connected || !socket) return;
      var bytes:ByteArray = new ByteArray();
      try {
        bytes.writeUTFBytes(JSON.stringify(message) + "\n");
        if (bytes.length > MAX_MESSAGE_BYTES) {
          bytes.clear();
          bytes.writeUTFBytes(
            JSON.stringify({
              type: "error",
              requestId: message && message.requestId is Number ? message.requestId : -1,
              code: "message-too-large"
            }) + "\n"
          );
        }
        socket.writeBytes(bytes);
        socket.flush();
      } catch (_:Error) {
        connected = false;
      }
    }
  }
}
