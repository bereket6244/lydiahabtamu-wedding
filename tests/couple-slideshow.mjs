import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

let Slideshow;
vm.runInNewContext(readFileSync(new URL('../assets/couple-slideshow.js', import.meta.url), 'utf8'), {
  HTMLElement: class {},
  customElements: { define: (_, component) => { Slideshow = component; } },
  document: { hidden: false }, setTimeout, clearTimeout
});

function fixture(index = 0) {
  const slideshow = new Slideshow();
  slideshow.index = index;
  slideshow.motion = { matches: false };
  slideshow.paused = true;
  slideshow.track = { style: {}, getBoundingClientRect() {}, querySelectorAll: () => [] };
  slideshow.shadowRoot = { querySelectorAll: () => [] };
  const pointers = new Set();
  const frame = {
    clientWidth: 340,
    classList: { add() {}, remove() {} },
    setPointerCapture: id => pointers.add(id),
    hasPointerCapture: id => pointers.has(id),
    releasePointerCapture: id => pointers.delete(id)
  };
  const event = (x, y, time = 0, pointerId = 1) => ({
    clientX: x, clientY: y, timeStamp: time, pointerId,
    button: 0, isPrimary: true, pointerType: 'touch'
  });
  slideshow.startGesture(event(170, 200), frame);
  return { slideshow, frame, event };
}

test('horizontal drag follows the finger and swipes left to the next photo', () => {
  const { slideshow: s, frame, event } = fixture(2);
  s.moveGesture(event(90, 205, 200));
  assert.match(s.track.style.transform, /-300%.*-80px/);
  s.endGesture(event(70, 205, 300));
  assert.equal(s.index, 3);
  assert.equal(s.gesture, null);
  assert.equal(frame.hasPointerCapture(1), false);
});

test('swipes wrap in either direction using adjacent clones', () => {
  const left = fixture(5);
  left.slideshow.endGesture(left.event(70, 200, 300));
  assert.equal(left.slideshow.index, 6);
  const right = fixture(0);
  right.slideshow.endGesture(right.event(270, 200, 300));
  assert.equal(right.slideshow.index, -1);
  assert.equal(right.slideshow.track.style.transform, 'translateX(-0%)');
});

test('vertical scrolling locks the axis without changing photos', () => {
  const { slideshow: s, event } = fixture(2);
  s.moveGesture(event(175, 240, 100));
  s.endGesture(event(280, 280, 300));
  assert.equal(s.index, 2);
});

test('taps and short slow drags snap back; short quick flicks advance', () => {
  for (const [distance, duration, expected] of [[0, 50, 2], [25, 500, 2], [25, 40, 3]]) {
    const { slideshow: s, event } = fixture(2);
    s.endGesture(event(170 - distance, 200, duration));
    assert.equal(s.index, expected);
  }
});

test('cancelled gestures snap back and release capture', () => {
  const { slideshow: s, frame, event } = fixture(2);
  s.moveGesture(event(50, 200, 100));
  s.endGesture(event(50, 200, 120), true);
  assert.equal(s.index, 2);
  assert.equal(frame.hasPointerCapture(1), false);
});

test('unrelated pointers cannot complete a gesture', () => {
  const { slideshow: s, event } = fixture(2);
  s.endGesture(event(50, 200, 120, 2));
  assert.equal(s.index, 2);
  assert.equal(s.gesture.id, 1);
});

test('autoplay stays stopped during a drag', () => {
  const { slideshow: s } = fixture();
  s.paused = false;
  s.visible = true;
  s.schedule();
  assert.equal(s.timer, undefined);
});

test('reduced motion wraps immediately to the real slide', () => {
  const { slideshow: s, event } = fixture(0);
  s.motion.matches = true;
  s.endGesture(event(270, 200, 300));
  assert.equal(s.index, 5);
  assert.equal(s.track.style.transform, 'translateX(-600%)');
});
