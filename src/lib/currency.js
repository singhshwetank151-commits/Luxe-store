export const STORE_CURRENCY = 'INR';

export function formatInr(amount, options = {}) {
  const num = Number(amount || 0);
  if (!Number.isFinite(num)) return '₹0';
  const hasFraction = Math.abs(num - Math.round(num)) > 0.001;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: options.alwaysShowPaise ? 2 : hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
