import { SocialIcons } from './SocialIcons';
import { GradientRing3D } from './GradientRing3D';
import { useRouter } from '../context/storeHooks';
import { withBase } from '../lib/basePath';

export function Hero() {
  const { navigate } = useRouter();

  return (
    <main className="hero-section">
      {/* Subtle static horological chapter ring behind the watch */}
      <GradientRing3D layer="back" />

      {/* Left Brand Heading & CTA */}
      <section className="hero-left">
        <p className="hero-eyebrow">Swiss-inspired skeleton horology</p>
        <h1 className="hero-title">
          <span>Luxe</span>
          <span>Store</span>
        </h1>
        <div className="hero-actions">
          <button
            type="button"
            className="shop-now-btn"
            onClick={() => navigate('/collection')}
          >
            Shop collection
          </button>
        </div>
      </section>

      {/* Right Editorial Copy */}
      <section className="hero-editorial">
        <p className="editorial-text">
          Openworked mechanical chronographs in 316L steel, titanium, and 18K gold
        </p>
      </section>

      {/* Centerpiece Watch Product Photography */}
      <div className="hero-watch-container">
        <img
          src={withBase('/watch.png')}
          alt="Silver mechanical skeleton chronograph luxury wristwatch"
          className="hero-watch-img"
        />
      </div>

      {/* Bottom-Left Social Icons */}
      <SocialIcons />
    </main>
  );
}
