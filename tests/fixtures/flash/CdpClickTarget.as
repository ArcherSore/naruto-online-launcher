package {
  import flash.display.Sprite;
  import flash.display.StageAlign;
  import flash.display.StageScaleMode;
  import flash.events.Event;
  import flash.events.MouseEvent;
  import flash.external.ExternalInterface;
  import flash.text.TextField;
  import flash.text.TextFormat;
  import flash.utils.getTimer;

  /**
   * Local PPAPI input target used by tests/runtime/cdp-ppapi-background-smoke.js.
   *
   * The target is intentionally self-contained: a click changes its pixels and
   * reports the count to the host page through ExternalInterface.
   */
  [SWF(width="320", height="200", frameRate="30", backgroundColor="#20242B")]
  public final class CdpClickTarget extends Sprite {
    private var clickCount:int = 0;
    private var firstTarget:Sprite;
    private var secondTarget:Sprite;
    private var labels:Object = {};

    public function CdpClickTarget() {
      if (stage) {
        initialize();
      } else {
        addEventListener(Event.ADDED_TO_STAGE, initialize);
      }
    }

    private function initialize(event:Event = null):void {
      removeEventListener(Event.ADDED_TO_STAGE, initialize);
      stage.align = StageAlign.TOP_LEFT;
      stage.scaleMode = StageScaleMode.NO_SCALE;
      stage.color = 0x20242B;

      firstTarget = createTarget("first", 25, "FIRST");
      secondTarget = createTarget("second", 175, "SECOND");

      if (ExternalInterface.available) {
        ExternalInterface.addCallback("getClickCount", getClickCount);
        ExternalInterface.addCallback("resetClickCount", resetClickCount);
        ExternalInterface.call("__flashReady");
      }
    }

    private function createTarget(id:String, x:Number, text:String):Sprite {
      var target:Sprite = new Sprite();
      target.name = id;
      target.x = x;
      drawTarget(target, 0xFF8C00);
      target.buttonMode = true;
      target.addEventListener(MouseEvent.CLICK, onTargetClick);
      addChild(target);

      var label:TextField = new TextField();
      label.defaultTextFormat = new TextFormat("_sans", 16, 0xFFFFFF, true);
      label.mouseEnabled = false;
      label.width = 100;
      label.height = 32;
      label.x = x;
      label.y = 84;
      label.text = text;
      labels[id] = label;
      addChild(label);
      return target;
    }

    private function drawTarget(target:Sprite, color:uint):void {
      target.graphics.clear();
      target.graphics.beginFill(color);
      target.graphics.drawRect(0, 60, 100, 70);
      target.graphics.endFill();
    }

    private function onTargetClick(event:MouseEvent):void {
      var target:Sprite = event.currentTarget as Sprite;
      clickCount++;
      drawTarget(target, 0x2EBD85);
      TextField(labels[target.name]).text = target.name.toUpperCase() + " " + clickCount;
      if (ExternalInterface.available) {
        ExternalInterface.call(
          "__flashClicked",
          clickCount,
          target.name,
          event.stageX,
          event.stageY,
          getTimer()
        );
      }
    }

    private function getClickCount():int {
      return clickCount;
    }

    private function resetClickCount():void {
      clickCount = 0;
      drawTarget(firstTarget, 0xFF8C00);
      drawTarget(secondTarget, 0xFF8C00);
      TextField(labels.first).text = "FIRST";
      TextField(labels.second).text = "SECOND";
    }
  }
}
