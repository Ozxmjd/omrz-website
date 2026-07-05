/* ==========================================================================
   OMRZ-AI — main.js
   Scroll reveal · sticky nav · mobiel menu · pricing toggle · contactform
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  /* ----- Sticky nav shadow ----- */
  const nav = document.querySelector('.nav');
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle('scrolled', window.scrollY > 20);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ----- Mobiel menu ----- */
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      toggle.classList.toggle('active');
    });
    links.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => links.classList.remove('open'))
    );
  }

  /* ----- Scroll reveal ----- */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('visible'));
  }

  /* ----- Pricing maand/jaar toggle ----- */
  const toggles = document.querySelectorAll('[data-pricing-toggle]');
  toggles.forEach(group => {
    const buttons = group.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode; // 'month' | 'year'
        buttons.forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('[data-price]').forEach(el => {
          el.textContent = el.dataset[mode] || el.dataset.price;
        });
        document.querySelectorAll('[data-period]').forEach(el => {
          el.textContent = mode === 'year' ? '/jaar' : '/maand';
        });
        document.querySelectorAll('[data-note]').forEach(el => {
          el.textContent = el.dataset[mode + 'Note'] || '';
        });
      });
    });
  });

  /* ----- Contactformulier (demo, geen backend) ----- */
  const form = document.querySelector('#contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const success = form.querySelector('.form-success');
      if (success) success.classList.add('show');
      form.reset();
    });
  }

  /* ----- Jaartal in footer ----- */
  document.querySelectorAll('[data-year]').forEach(el => {
    el.textContent = new Date().getFullYear();
  });
});
