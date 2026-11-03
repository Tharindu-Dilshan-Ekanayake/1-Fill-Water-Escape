import { useGame } from '../../store/game'
import EggPanel from './EggPanel'
import InteractPrompt from './InteractPrompt'
import LeftMenu from './LeftMenu'
import PassButtons from './PassButtons'
import RunOverlay from './RunOverlay'
import StatsPanel from './StatsPanel'
import TopBar from './TopBar'
import TopCenter from './TopCenter'
import WaterBar from './WaterBar'

/**
 * The heads-up display, laid out like the reference: Rebirths and Wins top-left over
 * the menu tiles, the passes on the right, your Water Power, level bar and Water packs
 * bottom-centre, the tutorial (and, out on the course, the stage and the next pit)
 * top-centre, and sound, daily rewards, leaderboards and your name tag top-right.
 *
 * The root ignores pointer events so the canvas and joystick underneath keep working;
 * only the buttons themselves opt back in. While a panel is open the HUD steps aside,
 * as in the reference.
 */
export function HUD() {
  const panelOpen = useGame((s) => s.panel !== null)
  return (
    <div className="pp-font pointer-events-none absolute inset-0 z-20 select-none">
      <div className="absolute inset-0 transition-opacity duration-150" style={{ opacity: panelOpen ? 0 : 1, visibility: panelOpen ? 'hidden' : 'visible' }}>
        <TopBar />
        <StatsPanel />
        <LeftMenu />
        <PassButtons />
        <TopCenter />
        <WaterBar />
        <InteractPrompt />
        <EggPanel />
        <RunOverlay />
      </div>
    </div>
  )
}

export default HUD
