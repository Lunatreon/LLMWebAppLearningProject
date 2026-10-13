// Pure state/timer port of the reference phrase cadence; no DOM ownership.
export function createTextPlayer(reveal: (text: string) => void, instant: () => boolean) {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let finishing = false;
  let nextRevealAt = 0;
  const sentenceEnd = /[.!?\u3002\uff01\uff1f]["'\u201d\u2019)]*\s*$/u;
  const clauseEnd = /[,;:\u2014\u3001\uff0c]["'\u201d\u2019)]*\s*$/u;
  const schedule = () => {
    timer = setTimeout(tick, Math.max(24, nextRevealAt - performance.now()));
  };
  function tick() {
    timer = null;
    if (stopped) return;
    let text = '';
    if (instant()) {
      text = pending;
      pending = '';
    } else {
      for (let index = 0, count = pending.length > 720 ? 4 : 2; index < count; index++) {
        const word = pending.match(/^(?:\s+|\S+?(?:\s+|[\u3002\uff01\uff1f]))/u);
        if (!word) break;
        text += word[0];
        pending = pending.slice(word[0].length);
        if (sentenceEnd.test(text) || clauseEnd.test(text) || /\n\s*\n/.test(text)) break;
      }
    }
    if (text) reveal(text);
    if (text && !instant()) {
      const phraseTime = 90 + Math.min(130, Array.from(text.trim()).length * 4);
      let pause = 0;
      if (/\n\s*\n/.test(text)) {
        pause = 360;
      } else if (sentenceEnd.test(text)) {
        pause = 260;
      } else if (clauseEnd.test(text)) {
        pause = 130;
      }
      nextRevealAt = performance.now() + phraseTime + pause;
    }
    if (pending && text) schedule();
  }
  return {
    push(text: string) {
      if (stopped || finishing) return;
      pending += text;
      if (timer === null) schedule();
    },
    finish() {
      if (stopped || finishing) return;
      finishing = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending) reveal(pending);
      pending = '';
    },
    cancel() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = '';
    },
  };
}
