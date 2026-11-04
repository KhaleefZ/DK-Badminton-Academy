// Photos that ship with the website. Everything else it says comes from the admin panel
// (see lib/site.jsx); siteDefaults.json is the same starting text the server holds.
import playerSmash from '../assets/images/player-smash.jpg';
import playerWide from '../assets/images/player-wide.jpg';
import playerJump from '../assets/images/player-jump.jpg';
import hallSteel from '../assets/images/hall-steel.jpg';
import hallArched from '../assets/images/hall-arched.jpg';
import shuttleAngle from '../assets/images/shuttle-angle.jpg';
import shuttleClose from '../assets/images/shuttle-close.jpg';
import shuttleLine from '../assets/images/shuttle-line.jpg';

export const bundledImages = { playerSmash, playerWide, playerJump, hallSteel, hallArched, shuttleAngle, shuttleClose, shuttleLine };

export const managementUrl = import.meta.env.VITE_MANAGEMENT_URL || 'http://localhost:5174';
