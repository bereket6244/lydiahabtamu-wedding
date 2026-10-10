// Self-contained so invitation language and music updates preserve the slideshow.
class CoupleSlideshow extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.index = 0;
    this.paused = false;
    this.visible = false;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    const descriptions = [
      'Habtamu and Lydia holding a white parasol',
      'Habtamu and Lydia smiling beneath a parasol',
      'Habtamu and Lydia looking at each other beneath a parasol',
      'Habtamu kissing Lydia’s hand at sunset',
      'Lydia resting her head on Habtamu’s shoulder',
      'Habtamu and Lydia holding hands beneath white drapes'
    ];
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { color: #8A6B4C; }
        * { box-sizing: border-box; }
        .frame { overflow: hidden; aspect-ratio: 3 / 4; border-radius: 8px; border: 1px solid #B99B69; box-shadow: 0 14px 38px #5a46321f; background: #e9ddc7; touch-action: pan-y; }
        .track { display: flex; height: 100%; transition: transform 900ms cubic-bezier(.22, 1, .36, 1); }
        img { display: block; flex: 0 0 100%; width: 100%; height: 100%; object-fit: cover; min-width: 0; }
        .controls { display: flex; justify-content: center; align-items: center; gap: 5px; margin-top: 18px; }
        button { display: inline-flex; align-items: center; justify-content: center; border: 0; padding: 0; width: 34px; height: 44px; background: transparent; color: inherit; cursor: pointer; font: 22px Georgia, serif; border-radius: 50%; }
        button:focus-visible { outline: 2px solid #8A6B4C; outline-offset: 2px; }
        .dot { width: 26px; }
        .dot::before { content: ''; width: 6px; height: 6px; border: 1px solid #A38044; border-radius: 50%; transition: background .2s; }
        .dot[aria-current="true"]::before { background: #A38044; }
        .pause { font-size: 14px; }
        @media (prefers-reduced-motion: reduce) { .track { transition: none; } }
      </style>
      <div role="region" aria-roledescription="carousel" aria-label="Wedding portraits">
        <div class="frame"><div class="track">
          ${[...descriptions, descriptions[0]].map((alt, i) => `<img src="assets/couple-slide-${i % 6 + 1}.webp" alt="${alt}" width="960" height="1280" loading="lazy" decoding="async" draggable="false" aria-hidden="${i !== 0}">`).join('')}
        </div></div>
        <div class="controls">
          <button class="previous" aria-label="Previous photo" type="button">&#8249;</button>
          ${descriptions.map((_, i) => `<button class="dot" type="button" aria-label="Show photo ${i + 1} of 6" aria-current="${i === 0}"></button>`).join('')}
          <button class="next" aria-label="Next photo" type="button">&#8250;</button>
          <button class="pause" aria-label="Pause slideshow" type="button">&#10074;&#10074;</button>
        </div>
      </div>`;
    this.track = root.querySelector('.track');
    this.pauseButton = root.querySelector('.pause');
    root.querySelector('.previous').onclick = () => this.select((this.index + 5) % 6);
    root.querySelector('.next').onclick = () => this.select((this.index + 1) % 6);
    root.querySelectorAll('.dot').forEach((dot, i) => { dot.onclick = () => this.select(i); });
    this.pauseButton.onclick = () => {
      this.paused = !this.paused;
      this.updatePlayback();
    };
    this.track.addEventListener('transitionend', (event) => {
      if (event.propertyName === 'transform' && this.index === 6) this.show(0, false);
    });
    const frame = root.querySelector('.frame');
    frame.addEventListener('pointerdown', event => { this.startX = event.clientX; this.startY = event.clientY; });
    frame.addEventListener('pointerup', event => {
      const dx = event.clientX - this.startX;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(event.clientY - this.startY)) {
        this.select((this.index + (dx < 0 ? 1 : 5)) % 6);
      }
    });
    this.addEventListener('mouseenter', () => { this.hovered = true; this.schedule(); });
    this.addEventListener('mouseleave', () => { this.hovered = false; this.schedule(); });
    root.addEventListener('focusin', () => { this.focused = true; this.schedule(); });
    root.addEventListener('focusout', event => { this.focused = !!event.relatedTarget && root.contains(event.relatedTarget); this.schedule(); });
    this.visibilityChange = () => this.schedule();
    this.motionChange = () => this.updatePlayback();
    document.addEventListener('visibilitychange', this.visibilityChange);
    this.motion.addEventListener('change', this.motionChange);
    this.observer = new IntersectionObserver(entries => {
      this.visible = entries[0].isIntersecting;
      this.schedule();
    }, { threshold: 0.2 });
    this.observer.observe(this);
    this.updatePlayback();
  }

  show(index, animate = true) {
    this.index = index;
    this.track.style.transition = animate ? '' : 'none';
    this.track.style.transform = `translateX(-${index * 100}%)`;
    if (!animate) this.track.getBoundingClientRect();
    this.shadowRoot.querySelectorAll('.dot').forEach((dot, i) => dot.setAttribute('aria-current', String(i === index % 6)));
    this.track.querySelectorAll('img').forEach((img, i) => img.setAttribute('aria-hidden', String(i !== index)));
  }

  select(index) {
    this.show(index);
    this.schedule();
  }

  updatePlayback() {
    const stopped = this.paused || this.motion.matches;
    this.pauseButton.textContent = stopped ? '▶' : '❚❚';
    this.pauseButton.setAttribute('aria-label', stopped ? 'Play slideshow' : 'Pause slideshow');
    this.pauseButton.hidden = this.motion.matches;
    this.pauseButton.style.display = this.motion.matches ? 'none' : '';
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.paused || this.motion.matches || !this.visible || this.hovered || this.focused || document.hidden) return;
    this.timer = setTimeout(() => {
      if (this.index === 6) this.show(0, false);
      this.show(this.index + 1);
      this.schedule();
    }, 4500);
  }

  disconnectedCallback() {
    clearTimeout(this.timer);
    this.observer?.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityChange);
    this.motion?.removeEventListener('change', this.motionChange);
  }
}

customElements.define('couple-slideshow', CoupleSlideshow);
