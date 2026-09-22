import './Placeholder.css';

/**
 * Temporary body for protected routes not yet implemented (Tasks, Projects,
 * Profile, Settings). Later frontend specs replace these without touching
 * routing or the app shell.
 */
export default function Placeholder({ title }: { title: string }) {
  return (
    <section className="placeholder" aria-labelledby="placeholder-title">
      <h1 id="placeholder-title" className="placeholder__title">
        {title}
      </h1>
      <p className="placeholder__text">Coming soon.</p>
    </section>
  );
}
