/* Voice: speech-to-text for notes (browser speech recognition), read-aloud, and
   picking a follow-up date out of what was said ("follow up in two weeks"). */
(function (G) {
  'use strict';
  const { html, useState, useEffect, useRef } = htmPreact;
  const FS = G.FS;
  const SR = G.SpeechRecognition || G.webkitSpeechRecognition;
  const LKEY = 'fscc.voiceLang';
  const getLang = () => { try { return localStorage.getItem(LKEY) || 'en-CA'; } catch (e) { return 'en-CA'; } };
  const setLang = (l) => { try { localStorage.setItem(LKEY, l); } catch (e) { /* ignore */ } };

  // ---------- Dates from speech ----------
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3,
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15 };
  const UNIT = { day: 1, days: 1, jour: 1, jours: 1, week: 7, weeks: 7, semaine: 7, semaines: 7, month: 30, months: 30, mois: 30 };
  const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
  function parseFollowUp(text, from = FS.today()) {
    const t = ' ' + String(text || '').toLowerCase().replace(/[.,!?;]/g, ' ') + ' ';
    let m = t.match(/\b(?:in|within|dans|d'ici)\s+(?:a\s+|une?\s+)?(\d+|[a-zé]+)(?:\s+of)?\s+(days?|weeks?|months?|jours?|semaines?|mois)\b/);
    if (m) { const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]]; if (n) return FS.addDays(from, n * UNIT[m[2]]); }
    if (/\b(tomorrow|demain)\b/.test(t)) return FS.addDays(from, 1);
    if (/\b(next week|la semaine prochaine)\b/.test(t)) return FS.addDays(from, 7);
    if (/\b(next month|le mois prochain)\b/.test(t)) return FS.addDays(from, 30);
    m = t.match(/\b(?:on|next|this|ce|lundi|mardi|mercredi|jeudi|vendredi)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/);
    if (m && /\b(follow|call|back|visit|meet|see|email|rappel|suivi|rencontre|appeler|revoir)/.test(t)) {
      const d = FS.parseISO(from); const want = DOW[m[1]]; let add = (want - d.getDay() + 7) % 7; if (add === 0) add = 7;
      return FS.addDays(from, add);
    }
    return null;
  }
  // "Next step is to send the quote" → "send the quote"
  function parseNextAction(text) {
    const m = String(text || '').match(/\b(?:next steps?|next action|to do|prochaine étape|à faire)\s*(?:is|are|:|est|,)?\s*(?:to\s+)?([^.!?]{4,140})/i);
    return m ? m[1].trim().replace(/^\w/, (x) => x.toUpperCase()) : null;
  }

  // ---------- Read aloud ----------
  function speak(text) {
    if (!G.speechSynthesis) return alert('Read-aloud is not available in this browser.');
    G.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = getLang(); u.rate = 1;
    G.speechSynthesis.speak(u);
  }
  const stopSpeaking = () => G.speechSynthesis && G.speechSynthesis.cancel();

  // ---------- Mic button ----------
  // onText(finalText) is called for each finished phrase.
  function MicButton({ onText, big }) {
    const [on, setOn] = useState(false);
    const [lang, setL] = useState(getLang());
    const [interim, setInterim] = useState('');
    const rec = useRef(null);
    useEffect(() => () => { if (rec.current) { rec.current.onend = null; rec.current.abort(); } }, []);
    if (!SR) return html`<span class="small muted">Tip: tap the 🎤 on your phone's keyboard to dictate.</span>`;
    const start = () => {
      const r = new SR();
      r.lang = lang; r.continuous = true; r.interimResults = true;
      r.onresult = (e) => {
        let fin = '', mid = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const s = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin += s; else mid += s;
        }
        setInterim(mid);
        if (fin.trim()) onText(fin.trim());
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') alert('Microphone is blocked. Allow microphone access for this site in your browser settings.');
        else if (e.error !== 'no-speech' && e.error !== 'aborted') console.warn('Speech error', e.error);
      };
      r.onend = () => { setOn(false); setInterim(''); rec.current = null; };
      rec.current = r;
      try { r.start(); setOn(true); } catch (x) { setOn(false); }
    };
    const stop = () => { if (rec.current) rec.current.stop(); };
    const flip = () => { const l = lang === 'en-CA' ? 'fr-CA' : 'en-CA'; setL(l); setLang(l); };
    return html`<span class="mic">
      <button type="button" class=${'micbtn' + (on ? ' on' : '') + (big ? ' big' : '')} onClick=${on ? stop : start} title=${on ? 'Stop' : 'Speak'}>
        ${on ? '■ Stop' : '🎤 Speak'}</button>
      <button type="button" class="sm ghost" onClick=${flip} disabled=${on} title="Speech language">${lang === 'en-CA' ? 'EN' : 'FR'}</button>
      ${on && html`<span class="small muted mic-live">${interim || 'Listening…'}</span>`}
    </span>`;
  }

  G.Voice = { supported: !!SR, MicButton, parseFollowUp, parseNextAction, speak, stopSpeaking, getLang };
})(window);
