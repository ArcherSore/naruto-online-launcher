package {
  import flash.display.Sprite;
  import flash.events.Event;
  import flash.events.MouseEvent;
  import flash.external.ExternalInterface;
  import flash.display.StageAlign;
  import flash.display.StageScaleMode;
  import flash.text.TextField;
  import flash.text.TextFormat;

  /**
   * Local PPAPI input target used by tests/runtime/cdp-ppapi-background-smoke.js.
   *
   * The target is intentionally self-contained: a click changes its pixels and
   * reports the count to the host page through ExternalInterface.
   */
  [SWF(width="320", height="200", frameRate="30", backgroundColor="#20242B")]
  public final class CdpClickTarget extends Sprite {
    private var clickCount:int = 0;
    private var target:Sprite;
    private var label:TextField;

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

      target = new Sprite();
      drawTarget(0xFF8C00);
      target.buttonMode = true;
      target.addEventListener(MouseEvent.CLICK, onTargetClick);
      addChild(target);

      label = new TextField();
      label.defaultTextFormat = new TextFormat("_sans", 20, 0xFFFFFF, true);
      label.mouseEnabled = false;
      label.width = 160;
      label.height = 40;
      label.x = 80;
      label.y = 82;
      label.text = "CDP TARGET";
      addChild(label);

      if (ExternalInterface.available) {
        ExternalInterface.addCallback("getClickCount", getClickCount);
        ExternalInterface.call("__flashReady");
      }
    }

    private function drawTarget(color:uint):void {
      target.graphics.clear();
      target.graphics.beginFill(color);
      target.graphics.drawRect(80, 60, 160, 80);
      target.graphics.endFill();
    }

    private function onTargetClick(event:MouseEvent):void {
      clickCount++;
      drawTarget(0x2EBD85);
      label.text = "CLICKED " + clickCount;
      if (ExternalInterface.available) {
        ExternalInterface.call("__flashClicked", clickCount);
      }
    }

    private function getClickCount():int {
      return clickCount;
    }
  }
}
