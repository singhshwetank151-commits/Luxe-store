export function SocialIcons() {
  return (
    <div className="social-bar" aria-label="Social Media Links">
      {/* WhatsApp */}
      <a
        href="#whatsapp"
        className="social-link"
        aria-label="WhatsApp"
        onClick={(e) => e.preventDefault()}
      >
        <svg width="27" height="27" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g transform="translate(12, 12) scale(0.76) translate(-12.4, -12.8)">
            <path
              d="M9.6 8.3c-.2-.45-.42-.46-.62-.47h-.53c-.19 0-.49.07-.75.35-.26.28-.98.96-.98 2.34s1.01 2.71 1.15 2.9c.14.19 1.94 3.11 4.8 4.24 2.37.94 2.86.75 3.37.7.52-.05 1.66-.68 1.9-1.33.23-.66.23-1.22.16-1.34-.07-.12-.26-.19-.54-.33-.28-.14-1.66-.82-1.92-.91-.26-.09-.45-.14-.63.14-.19.28-.72.91-.89 1.1-.16.19-.33.21-.61.07-.28-.14-1.19-.44-2.27-1.4-.84-.75-1.4-1.67-1.57-1.95-.16-.28-.02-.43.12-.57.13-.13.28-.33.42-.49.14-.16.19-.28.28-.47.09-.19.05-.35-.02-.49-.07-.14-.62-1.52-.87-2.08z"
              fill="currentColor"
            />
          </g>
        </svg>
      </a>

      {/* Instagram */}
      <a
        href="#instagram"
        className="social-link"
        aria-label="Instagram"
        onClick={(e) => e.preventDefault()}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" ry="5.5" />
          <circle cx="12" cy="12" r="4.2" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      </a>

      {/* Facebook */}
      <a
        href="#facebook"
        className="social-link"
        aria-label="Facebook"
        onClick={(e) => e.preventDefault()}
      >
        <svg width="27" height="27" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z" />
        </svg>
      </a>
    </div>
  );
}
