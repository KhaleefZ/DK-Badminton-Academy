/**
 * Submit-with-errors feedback: focus the first invalid control and shake its field once
 * (`.md-shake`, 300ms; reduced motion turns the shake off in motion.css, focus stays).
 * Runs on the next frame so the error states from the submit handler have rendered.
 * `fallback` selects a control without aria-invalid to flag when nothing else is invalid
 * (e.g. an unticked acknowledgement checkbox).
 */
export function flagFirstInvalid(form, fallback) {
  requestAnimationFrame(() => {
    const control = form.querySelector('[aria-invalid="true"]') ?? (fallback ? form.querySelector(fallback) : null);
    if (!control) return;
    control.focus();
    const target = control.closest('.field, .checkbox') ?? control;
    target.classList.remove('md-shake');
    void target.offsetWidth; // restart the animation if it is still applied
    target.classList.add('md-shake');
    target.addEventListener('animationend', () => target.classList.remove('md-shake'), { once: true });
  });
}
