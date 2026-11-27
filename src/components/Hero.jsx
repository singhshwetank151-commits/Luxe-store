import { SocialIcons } from './SocialIcons';
import { GradientRing3D } from './GradientRing3D';
import { useRouter } from '../context/storeHooks';

export function Hero() {
  const { navigate } = useRouter();

  return (
    <main className="hero-section">
      {/* Back half of 3D swirling gradient ring (passes behind editorial text) */}
      <GradientRing3D layer="back" />

      {/* Left Brand Heading & CTA */}
      <section className="hero-left">
        <h1 className="hero-title">
          <span>Luxe</span>
          <span>Store</span>
        </h1>
        <button
          type="button"
          className="shop-now-btn"
          onClick={() => navigate('/collection')}
        >
          SHOP NOW
        </button>
      </section>

      {/* Right Editorial Copy */}
      <section className="hero-editorial">
        <p className="editorial-text">
          EXPERIENCE THE TIMELESS
          <br />
          BEAUTY OF OUR
          <br />
          MECHANICAL SKELETON
          <br />
          LUXURY WATCHES
        </p>
      </section>

      {/* Front half of 3D swirling gradient ring (sweeps in front of editorial text) */}
      <GradientRing3D layer="front" />

      {/* Oversized Floating Angled Watch Product Photography */}
      <div className="hero-watch-container">
        <img
          src="/watch.png"
          alt="Silver mechanical skeleton chronograph luxury wristwatch"
          className="hero-watch-img"
        />
      </div>

      {/* Bottom-Left Social Icons */}
      <SocialIcons />

      {/* Bottom-Right Floating Contact Button */}
      <button
        type="button"
        className="contact-fab"
        aria-label="Contact Us"
        onClick={() => {}}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z" />
        </svg>
      </button>
    </main>
  );
}
