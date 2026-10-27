import loop from './assets/confused-travolta.webp';
import still from './assets/confused-travolta-still.webp';
import styles from './Travolta.module.css';

/**
 * The confused Travolta loop for empty results and missing pages. An animated WebP keeps the GIF's transparency at a
 * fraction of its size, and it only loads where it is shown. With reduced motion the browser picks the still frame.
 */
export function Travolta() {
  return <picture className={styles.clip} aria-hidden="true">
    <source srcSet={still} media="(prefers-reduced-motion: reduce)" />
    <img src={loop} alt="" width={490} height={476} decoding="async" />
  </picture>;
}
