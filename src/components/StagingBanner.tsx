const REPEATS_PER_GROUP = 10;

export default function StagingBanner() {
  if (process.env.NODE_ENV !== 'development') return null;

  const message =
    'This is a test version of our app. Do not use with real data. Any data at this environment can be lost at any time.';
  const copies = Array.from({ length: REPEATS_PER_GROUP });

  return (
    <div className="staging-banner">
      <p className="staging-banner__announce" role="status">
        {message}
      </p>
      <div className="staging-banner__track" aria-hidden="true">
        <div className="staging-banner__group">
          {copies.map((_, i) => (
            <span key={i}>{message}</span>
          ))}
        </div>
        <div className="staging-banner__group">
          {copies.map((_, i) => (
            <span key={i}>{message}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
