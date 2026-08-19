// Identical to the Marketing Portal's components/ui/GyftrLogo.jsx — same asset,
// same sizing rule — so the brand mark is literally the same component in both
// products. Do not restyle this; if the logo changes, it changes in both tools.
import logo from '../assets/logo.png';

export function GyftrLogo({ fs = 18 }) {
  return (
    <img src={logo} alt="GYFTR" draggable={false}
      style={{ height: Math.round(fs * 2), width: 'auto', display: 'block' }} />
  );
}
