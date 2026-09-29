document.documentElement.classList.add('v5');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sections = [...document.querySelectorAll('main > section, main > article')];
sections[0]?.classList.add('v5-in');

if (!reduced && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add('v5-in');
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  sections.slice(1).forEach((section, index) => {
    section.style.setProperty('--v5-order', index);
    observer.observe(section);
  });
} else {
  sections.forEach((section) => section.classList.add('v5-in'));
}

const updateProgress = () => {
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  document.documentElement.style.setProperty('--page-progress', `${scrollY / max}`);
};
addEventListener('scroll', updateProgress, { passive: true });
updateProgress();

document.querySelectorAll('header nav a').forEach((link) => {
  const current = location.pathname;
  const href = new URL(link.href).pathname;
  if (href !== '/' && current.startsWith(href)) link.setAttribute('aria-current', 'page');
});
