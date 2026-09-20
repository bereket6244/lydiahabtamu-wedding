(() => {
  'use strict';
  window.initGuestPhotoGallery = (component, root) => {
    const find = id => root.querySelector('#' + id);
    const track = find('guest-gallery-track');
    const empty = find('guest-gallery-empty');
    const input = find('guest-photo-input');
    const upload = find('guest-photo-upload-label');
    const uploadText = find('guest-photo-upload-text');
    const uploadCount = find('guest-photo-upload-count');
    const status = find('guest-upload-status');
    const prev = root.querySelector('[data-direction="prev"]');
    const next = root.querySelector('[data-direction="next"]');
    const actions = document.createElement('div');
    actions.className = 'gallery-actions';
    const count = document.createElement('span');
    const all = document.createElement('button');
    all.className = 'gallery-button';
    all.type = 'button';
    all.setAttribute('aria-haspopup', 'dialog');
    actions.append(count, all);
    track.parentElement.append(actions);

    const dialog = document.createElement('dialog');
    dialog.className = 'gallery-dialog';
    dialog.setAttribute('aria-labelledby', 'gallery-title');
    dialog.innerHTML = '<header class="gallery-header"><h2 id="gallery-title"></h2><button type="button" class="gallery-button" data-close></button></header><p class="gallery-summary"></p><div class="gallery-grid"></div>';
    const viewer = document.createElement('dialog');
    viewer.className = 'gallery-dialog gallery-viewer';
    viewer.setAttribute('aria-label', 'Photo viewer');
    viewer.innerHTML = '<header class="gallery-header"><span data-position></span><button type="button" class="gallery-button" data-close></button></header><div class="gallery-viewer-frame"><img alt=""></div><p class="gallery-viewer-status" role="status" aria-live="polite"></p><div class="gallery-viewer-nav"><button type="button" class="gallery-button" data-prev></button><button type="button" class="gallery-button" data-retry hidden></button><button type="button" class="gallery-button" data-next></button></div>';
    document.body.append(dialog, viewer);
    const grid = dialog.querySelector('.gallery-grid');
    const image = viewer.querySelector('img');
    const imageStatus = viewer.querySelector('[role="status"]');
    const retry = viewer.querySelector('[data-retry]');
    let photos = [];
    let selected = 0;
    let loading = true;
    let failed = false;
    let busy = false;
    let previousOverflow = '';
    let loadVersion = 0;
    const words = () => !component.state.isAmharic ? {
      all: 'See full gallery', title: 'Our shared memories', back: 'Back to invitation', close: 'Close photo',
      hint: 'Tap any photo to view the full-resolution image.', loading: 'Loading photos…', retry: 'Try again',
      full: 'Loading full-resolution photo…', error: 'This photo could not load. Please try again.',
      previous: 'Previous', next: 'Next', view: 'View photo', remove: 'Delete photo',
    } : {
      all: 'ሙሉ የፎቶ ማዕከለ ስዕላትን ይመልከቱ', title: 'የጋራ ትዝታዎቻችን', back: 'ወደ ግብዣው ይመለሱ', close: 'ፎቶውን ዝጋ',
      hint: 'ፎቶውን ሙሉ ጥራት ለማየት ይንኩ።', loading: 'ፎቶዎች በመጫን ላይ…', retry: 'እንደገና ይሞክሩ',
      full: 'ሙሉ ጥራት ያለው ፎቶ በመጫን ላይ…', error: 'ፎቶው አልተጫነም። እንደገና ይሞክሩ።',
      previous: 'ቀዳሚ', next: 'ቀጣይ', view: 'ፎቶ ይመልከቱ', remove: 'ፎቶ አጥፋ',
    };
    const photoCount = () => photos.length === 1 ? component.copy().photoSingular : component.copy().photoPlural(photos.length);
    const date = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
    const syncLabels = () => {
      const text = words();
      all.textContent = failed ? text.retry : text.all;
      count.textContent = loading ? text.loading : (failed ? '' : photoCount());
      dialog.querySelector('h2').textContent = text.title;
      dialog.querySelector('[data-close]').textContent = text.back;
      dialog.querySelector('.gallery-summary').textContent = photoCount() + ' · ' + text.hint;
      viewer.querySelector('[data-close]').textContent = text.close;
      viewer.querySelector('[data-prev]').textContent = text.previous;
      viewer.querySelector('[data-next]').textContent = text.next;
      retry.textContent = text.retry;
      if (!busy) uploadText.textContent = component.copy().sharePhotoText;
    };
    component._syncGalleryLabels = syncLabels;
    const syncScroll = () => {
      const overflow = track.scrollWidth > track.clientWidth + 2;
      prev.classList.toggle('is-visible', overflow);
      next.classList.toggle('is-visible', overflow);
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
    };
    const openDialog = modal => {
      if (!dialog.open && !viewer.open) previousOverflow = document.body.style.overflow;
      modal.showModal();
      document.body.style.overflow = 'hidden';
    };
    const showPhoto = index => {
      if (!photos[index]) return;
      selected = index;
      const photo = photos[index];
      const version = ++loadVersion;
      image.src = photo.previewSrc;
      image.alt = component.copy().photoAltFrom(date(photo.createdAt));
      imageStatus.textContent = words().full;
      retry.hidden = true;
      viewer.querySelector('[data-position]').textContent = (index + 1) + ' / ' + photos.length;
      viewer.querySelector('[data-prev]').disabled = index === 0;
      viewer.querySelector('[data-next]').disabled = index === photos.length - 1;
      if (!viewer.open) openDialog(viewer);
      // Only a deliberate photo selection requests the original.
      const full = new Image();
      full.onload = () => {
        if (version !== loadVersion || !viewer.open) return;
        image.src = photo.src;
        imageStatus.textContent = '';
      };
      full.onerror = () => {
        if (version !== loadVersion || !viewer.open) return;
        imageStatus.textContent = words().error;
        retry.hidden = false;
      };
      full.src = photo.src;
    };
    for (const modal of [dialog, viewer]) {
      modal.querySelector('[data-close]').addEventListener('click', () => modal.close());
      modal.addEventListener('click', event => {
        if (event.target !== modal) return;
        const box = modal.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.close();
      });
      modal.addEventListener('close', () => {
        if (modal === viewer) { ++loadVersion; image.removeAttribute('src'); }
        if (!dialog.open && !viewer.open) document.body.style.overflow = previousOverflow;
      });
    }
    viewer.querySelector('[data-prev]').addEventListener('click', () => showPhoto(selected - 1));
    viewer.querySelector('[data-next]').addEventListener('click', () => showPhoto(selected + 1));
    retry.addEventListener('click', () => showPhoto(selected));
    viewer.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); showPhoto(selected - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); showPhoto(selected + 1); }
    });
    const setStatus = (message, progress = 0, label = '') => {
      status.textContent = message;
      status.classList.toggle('is-visible', Boolean(message));
      upload.classList.toggle('is-uploading', busy);
      upload.setAttribute('aria-busy', String(busy));
      upload.style.setProperty('--upload-progress', String(progress));
      input.disabled = busy;
      upload.disabled = busy;
      uploadCount.textContent = label;
      uploadText.textContent = busy ? component.copy().uploadingText : component.copy().sharePhotoText;
    };
    let device = '';
    const key = 'yeabsra-christian-engagement-device-id';
    try { device = localStorage.getItem(key) || ''; } catch {}
    if (!device) {
      device = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      try { localStorage.setItem(key, device); } catch {}
    }
    const cardFor = (photo, index, allowDelete) => {
      const card = document.createElement('article');
      card.className = 'guest-photo-card';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'guest-photo-view';
      button.setAttribute('aria-label', words().view + ' ' + (index + 1));
      const thumb = document.createElement('img');
      thumb.alt = component.copy().photoAltFrom(date(photo.createdAt));
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.src = photo.previewSrc;
      thumb.addEventListener('error', () => {
        thumb.hidden = true;
        const note = document.createElement('span');
        note.className = 'gallery-photo-error';
        note.textContent = words().view;
        button.append(note);
      }, { once: true });
      button.append(thumb);
      button.addEventListener('click', () => showPhoto(photos.findIndex(item => item.id === photo.id)));
      const meta = document.createElement('div');
      meta.className = 'guest-photo-meta';
      meta.textContent = date(photo.createdAt);
      card.append(button, meta);
      if (allowDelete && photo.canDelete) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'guest-photo-delete';
        remove.setAttribute('aria-label', words().remove);
        remove.textContent = '×';
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try {
            const response = await fetch('api/photos.php', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: device, id: photo.id }) });
            const result = await response.json();
            if (!response.ok || !result.deleted) throw new Error('Delete failed');
            photos = photos.filter(item => item.id !== photo.id);
            render();
          } catch { setStatus(component.copy().deleteFailedText); remove.disabled = false; }
        });
        meta.append(remove);
      }
      return card;
    };
    const renderGrid = () => grid.replaceChildren(...photos.map((photo, index) => cardFor(photo, index, false)));
    const render = () => {
      track.replaceChildren(...photos.map((photo, index) => cardFor(photo, index, true)));
      track.style.display = photos.length ? 'flex' : 'none';
      empty.style.display = photos.length || loading ? 'none' : 'block';
      empty.dataset.unavailable = String(failed);
      empty.textContent = failed ? component.copy().galleryUnavailableText : component.copy().emptyGalleryText;
      all.disabled = loading || (!failed && photos.length === 0);
      syncLabels();
      if (dialog.open) renderGrid();
      requestAnimationFrame(syncScroll);
    };
    const refresh = async () => {
      loading = true;
      render();
      try {
        const response = await fetch('api/gallery.php?device_id=' + encodeURIComponent(device), { cache: 'no-store' });
        if (!response.ok) throw new Error('Gallery unavailable');
        const data = await response.json();
        if (!Array.isArray(data.photos)) throw new Error('Invalid response');
        photos = data.photos;
        failed = false;
      } catch { failed = true; }
      loading = false;
      render();
    };
    all.addEventListener('click', () => {
      if (failed) { refresh(); return; }
      syncLabels();
      renderGrid();
      openDialog(dialog);
      dialog.scrollTop = 0;
    });
    const scroll = direction => {
      const card = track.querySelector('.guest-photo-card');
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      track.scrollBy({ left: direction * ((card?.offsetWidth || 300) + gap), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    prev.addEventListener('click', () => scroll(-1));
    next.addEventListener('click', () => scroll(1));
    track.addEventListener('scroll', syncScroll, { passive: true });
    window.addEventListener('resize', syncScroll);
    input.multiple = true;
    input.addEventListener('change', async () => {
      if (busy) return;
      const files = Array.from(input.files || []).filter(file => file.type.startsWith('image/'));
      if (!files.length) return;
      const selectedFiles = files.slice(0, 12);
      busy = true;
      setStatus(component.copy().readPrefix + selectedFiles.length, .04, '0/' + selectedFiles.length);
      let added = 0;
      let skipped = 0;
      try {
        const sources = await Promise.all(selectedFiles.map(file => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = reject;
          reader.onload = () => resolve({ src: reader.result });
          reader.readAsDataURL(file);
        })));
        const result = await new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open('POST', 'api/photos.php');
          request.setRequestHeader('Content-Type', 'application/json');
          request.upload.onprogress = event => {
            if (event.lengthComputable) setStatus(component.copy().uploadingText, .3 + .7 * event.loaded / event.total, selectedFiles.length + '');
          };
          request.onerror = reject;
          request.onload = () => {
            try {
              const data = JSON.parse(request.responseText);
              request.status >= 200 && request.status < 300 ? resolve(data) : reject(new Error('Upload failed'));
            } catch (error) { reject(error); }
          };
          request.send(JSON.stringify({ deviceId: device, photos: sources }));
        });
        added = result.added || 0;
        skipped = result.skipped || 0;
      } catch {}
      busy = false;
      input.value = '';
      await refresh();
      let message = added ? component.copy().addedText(added) : component.copy().uploadFailedText;
      if (skipped) message += ' ' + component.copy().skippedText(skipped);
      if (files.length > 12) message += ' ' + component.copy().limitNoteText;
      setStatus(message);
    });
    refresh();
  };
})();
