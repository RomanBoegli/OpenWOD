import { Icon } from './Icon';
import { Travolta } from './Travolta';
import shared from './App.module.css';
import styles from './NotFound.module.css';

/** Shown for a route the app does not know, and for a workout link whose workout is not in this library. */
export function NotFound({ missingId }: { missingId?: string }) {
  return <section className={styles.notFound} aria-labelledby="not-found-title">
    <Travolta />
    <p className={shared.eyebrow}>404</p>
    <h1 id="not-found-title">{missingId ? 'Workout not found' : 'Page not found'}</h1>
    <p>{missingId ? <>No workout with the ID “{missingId}” is in this library. It may have been removed.</> : 'Nothing lives at this address.'}</p>
    <a href="#/" className={shared.primaryButton}><Icon name="back" size={17} />Back to the library</a>
  </section>;
}
