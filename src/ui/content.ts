/** Loading-screen control tips (G11) and the How to Play page. */
export const TIPS = [
  'Hold LOCK and sweep the reticle across up to six targets, then release to fire a missile volley.',
  'A barrel roll makes you briefly immune — time it just before a missile hits.',
  'Afterburner outruns enemy fire; the air-brake makes tail-chasers overshoot into your sights.',
  'Kills within 1.5 seconds chain your score multiplier up to ×8.',
  'Bandits behind you show as arrows at the bottom of the screen.',
  'Boss armour only breaks where it glows — destroy each phase’s weak points to expose the core.',
];

export function controlsHtml(): string {
  return `
  <div class="controls-grid">
    <div>
      <h3>Keyboard + mouse</h3>
      <table>
        <tr><td>Steer</td><td>WASD / Arrows — or mouse (click to capture)</td></tr>
        <tr><td>Vulcan cannon</td><td>Space / J / Left mouse</td></tr>
        <tr><td>Lock &amp; missiles</td><td>Hold K / X / Right mouse, release to fire</td></tr>
        <tr><td>Barrel roll</td><td>L / C — or double-tap a direction</td></tr>
        <tr><td>Afterburner / brake</td><td>Shift or E / Q or Z</td></tr>
        <tr><td>Pause · Fullscreen</td><td>Esc / P · F</td></tr>
      </table>
    </div>
    <div>
      <h3>Gamepad</h3>
      <table>
        <tr><td>Steer</td><td>Left stick</td></tr>
        <tr><td>Vulcan</td><td>A</td></tr>
        <tr><td>Lock &amp; missiles</td><td>X / RB (hold, release)</td></tr>
        <tr><td>Barrel roll</td><td>B / LB</td></tr>
        <tr><td>Afterburner / brake</td><td>RT / LT</td></tr>
        <tr><td>Pause</td><td>Start</td></tr>
      </table>
      <h3>Touch</h3>
      <p>Left thumb steers. <b>AUTO</b> toggles auto-fire, <b>MSL</b> hold to lock, <b>ROLL</b>, <b>BOOST</b>, <b>BRAKE</b>.</p>
    </div>
  </div>`;
}
