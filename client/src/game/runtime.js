import { Vector3 } from 'three'

import { SPAWN } from '@shared/world'

/**
 * Per-frame mutable state shared between systems.
 *
 * Deliberately outside React and zustand: it changes every frame, nothing should
 * re-render because of it, and every reader lives in a `useFrame` or a timer. UI that
 * needs a slow-changing derivative of it (which zone the player is in, say) gets it
 * from the 10 Hz game ticker, which is the only thing that copies from here into the
 * store.
 */
export const runtime = {
  player: {
    position: new Vector3(SPAWN.x, 0, SPAWN.z),
    /** Facing, radians about +Y. PI faces north (-Z), towards the course. */
    yaw: Math.PI,
    speed: 0,
    grounded: true,
    /** 'idle' | 'walk' | 'scoop' (training in a well) | 'jump' | 'swim' - what other players see. */
    anim: 'idle',
    /** Set when the controller should ignore input. */
    frozen: false,
    /**
     * Pouring into a pit: the world point the stream lands on, or null. Written by the
     * course (course/pits.js) and read by the avatar and the stream FX.
     */
    pourAt: null,
    /** Where the lip of your bucket is in the world, for the stream to start from (Player.jsx). */
    bucketLip: new Vector3(),
    /** When you last tapped the screen for Water (performance.now()), to flick the bucket. */
    tappedAt: -1e9,
  },

  /** Touch input, written by the on-screen joystick. -1..1, +y = forward. */
  input: {
    joyX: 0,
    joyY: 0,
    jump: false,
  },

  camera: {
    /** 'follow' orbits the player. */
    mode: 'follow',
    yaw: 0,
    pitch: 0.36,
    distance: 11,
    /** Set to jump the follow camera straight to its target next frame. */
    snap: false,
  },

  /**
   * Other players' pets, written by the multiplayer layer: `{ id, position, yaw, hop }`
   * per pet. Drawn by the same instanced pet meshes as yours.
   */
  remotePets: [],

  /** Walls that come and go at runtime: locked wells. */
  dynamicColliders: [],
  /**
   * The course's wall across the near rim of the first pit you can't cross yet (or that
   * is still filling), or null: kept apart from dynamicColliders, which the ticker
   * rewrites when wells unlock.
   */
  pitWall: null,

  /**
   * Things that get a blob shadow on low presets. Each entry is
   * `{ position: Vector3, size: number, visible?: boolean }`.
   */
  shadowCasters: new Set(),
}
