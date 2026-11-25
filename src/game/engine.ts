import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RealmAudioEngine } from './audio';
import { CHARACTER_CLASSES, ENEMY_ARCHETYPES } from './catalog';
import {
  buildOpenWorld,
  createEnemyRig,
  createHeroRig,
  type AnimatedActorRig,
  type ObstacleCollider,
} from './meshes';
import {
  computeCharacterStats,
  computeCombatDamage,
  computeEffectiveSkill,
  decideEnemyAIState,
  getBiomeAt,
  stepComboTimer,
  terrainHeightAt,
} from './rules';
import { createProceduralTextureSet, type ProceduralTextureSet } from './textures';
import type {
  CharacterClassId,
  CharacterStats,
  EnemyAIState,
  EnemyArchetypeId,
  FloatingDamageEvent,
  GamePhase,
  HUDRuntimeSnapshot,
  LineageId,
  PlayerProfile,
  RemotePlayerState,
  StatusEffectType,
} from './types';

interface ActiveEnemy {
  id: string;
  archetype: EnemyArchetypeId;
  level: number;
  rig: AnimatedActorRig;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  homeX: number;
  homeZ: number;
  patrolAngle: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  aiState: EnemyAIState;
  stateTimer: number;
  attackCooldown: number;
  hitFlashTimer: number;
  koTimer: number;
  walkPhase: number;
  statuses: Partial<Record<StatusEffectType, number>>;
  dotAccum: number;
}

interface ActiveProjectile {
  active: boolean;
  fromPlayer: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  life: number;
  damage: number;
  isCrit: boolean;
  statusEffect?: StatusEffectType;
  mesh: THREE.Mesh;
}

interface ShockwaveRing {
  active: boolean;
  x: number;
  y: number;
  z: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  mesh: THREE.Mesh;
}

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  r: number;
  g: number;
  b: number;
}

interface RemoteAvatarEntry {
  rig: AnimatedActorRig;
  classId: CharacterClassId;
  lineageId: LineageId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetYaw: number;
  walkPhase: number;
  state: RemotePlayerState;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HUDRuntimeSnapshot) => void;
  onFloatingDamage: (evt: FloatingDamageEvent) => void;
  onRewardEarned: (reward: { xp: number; gold: number; spiritStones: number; killedBoss: boolean; enemyName: string }) => void;
  onPlayerDefeated: (summary: { kills: number; damageDealt: number; elapsedSeconds: number; bossDefeated: boolean }) => void;
  onReviveTokenUsed: () => void;
  onPositionBroadcast: (pos: { x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; attacking: boolean }) => void;
  onPeerLabelsUpdate: (labels: Array<{ id: string; name: string; tag: string | null; screenX: number; screenY: number; hpRatio: number }>) => void;
}

// Reusable scratch math objects (Zero GC inside render loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();
const _colorScratch = new THREE.Color();
const _daySky = new THREE.Color('#74a9d8');
const _duskSky = new THREE.Color('#c27a56');
const _nightSky = new THREE.Color('#13192b');
const _currentSky = new THREE.Color('#74a9d8');

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class ShadowRealmsEngine {
  private mountEl: HTMLElement;
  private callbacks: EngineCallbacks;
  public readonly audio = new RealmAudioEngine();
  public readonly isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private textures: ProceduralTextureSet;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private beaconLight: THREE.PointLight;
  private colliders: ObstacleCollider[] = [];
  private animatedCrystals: THREE.Object3D[] = [];
  private banners: THREE.Object3D[] = [];

  private playerRig: AnimatedActorRig;
  private playerProfile: PlayerProfile;
  private playerStats: CharacterStats;

  // Player kinematic & combat state
  private px = 0;
  private py = 0;
  private pz = 14;
  private pvx = 0;
  private pvy = 0;
  private pvz = 0;
  private pyaw = Math.PI; // Facing -Z directly toward Solara Citadel Keep
  private grounded = true;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private walkPhase = 0;
  private squashX = 1;
  private squashY = 1;

  private hp = 260;
  private mana = 110;
  private stamina = 120;
  private skillCooldowns: [number, number, number, number] = [0, 0, 0, 0];
  private attackAnimTimer = 0;
  private attackSwingDir = 1;
  private hitFlashTimer = 0;
  private combo = 0;
  private comboTimer = 0;
  private hitstopTimer = 0;
  private cameraTrauma = 0;

  private sessionKills = 0;
  private sessionDamageDealt = 0;
  private elapsedPlayingSeconds = 0;
  private bossDefeated = false;
  private defeatPendingTimer = 0;

  // Camera orbit & tour
  private camYaw = 0;
  private camPitch = 0.36;
  private camDistance = 13.5;
  private isDraggingCamera = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private tourAngle = 0.35;
  private timeOfDay = 0.28; // Bright golden morning at start

  // Phase & Input
  private phase: GamePhase = 'title';
  private keysHeld = new Set<string>();
  private floatingDmgId = 1;

  // World entities
  private enemies: ActiveEnemy[] = [];
  private enemyIdCounter = 1;
  private respawnTimer = 0;
  private lockedTargetId: string | null = null;
  private remoteAvatars = new Map<string, RemoteAvatarEntry>();

  // Pooled VFX
  private projectiles: ActiveProjectile[] = [];
  private shockwaves: ShockwaveRing[] = [];
  private particles: ParticleSlot[] = [];
  private particleInst: THREE.InstancedMesh;
  private particleCursor = 0;

  // Loop timers
  private frameId = 0;
  private disposed = false;
  private lastTimeMs = 0;
  private hudEmitAccum = 0;
  private netEmitAccum = 0;
  private resizeObserver: ResizeObserver;

  constructor(mountEl: HTMLElement, initialProfile: PlayerProfile, callbacks: EngineCallbacks) {
    this.mountEl = mountEl;
    this.callbacks = callbacks;
    this.playerProfile = { ...initialProfile };
    this.isSoftwareGl = detectSoftwareGl();

    // Renderer configured per Three.js studio PBR + Software WebGL guard
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(1, mountEl.clientWidth || window.innerWidth);
    const height = Math.max(1, mountEl.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    mountEl.innerHTML = '';
    mountEl.appendChild(this.renderer.domElement);

    // Scene, Studio Environment Reflections (PMREM RoomEnvironment), and Horizon Fog
    this.scene = new THREE.Scene();
    this.scene.background = _currentSky.clone();
    this.scene.fog = new THREE.FogExp2(_currentSky.getHex(), 0.0082);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(56, width / height, 0.25, 280);
    this.camera.position.set(0, 14, 34);

    // Warm/cool 3-point outdoor lighting rig (1 shadow caster)
    this.hemiLight = new THREE.HemisphereLight('#9ec7f5', '#4b453a', 0.85);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff2d6', 2.05);
    this.sunLight.position.set(42, 64, 28);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 180;
    const d = 56;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Procedural textures & Open World geometry
    this.textures = createProceduralTextureSet(this.renderer);
    const built = buildOpenWorld(this.textures, this.isSoftwareGl);
    this.scene.add(built.worldGroup);
    this.colliders = built.colliders;
    this.animatedCrystals = built.animatedCrystals;
    this.banners = built.banners;
    this.beaconLight = built.beaconLight;

    // Player stats & hero rig
    this.playerStats = computeCharacterStats(
      initialProfile.classId,
      initialProfile.lineageId,
      initialProfile.level,
      initialProfile.cultivationTier,
      initialProfile.skillRanks
    );
    this.hp = this.playerStats.maxHp;
    this.mana = this.playerStats.maxMana;
    this.stamina = this.playerStats.maxStamina;
    this.px = Number.isFinite(initialProfile.lastX) ? Math.max(-72, Math.min(72, initialProfile.lastX)) : 0;
    this.pz = Number.isFinite(initialProfile.lastZ) ? Math.max(-72, Math.min(72, initialProfile.lastZ)) : 14;
    this.py = terrainHeightAt(this.px, this.pz);

    this.playerRig = createHeroRig(
      initialProfile.classId,
      initialProfile.lineageId,
      this.textures.contactShadow
    );
    this.playerRig.root.position.set(this.px, this.py, this.pz);
    this.playerRig.root.rotation.y = this.pyaw;
    this.scene.add(this.playerRig.root);

    // Pooled VFX setup (Zero GC in loop)
    const projGeo = new THREE.OctahedronGeometry(0.38, 0);
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: '#38bdf8',
        emissive: '#38bdf8',
        emissiveIntensity: 1.4,
        roughness: 0.2,
      });
      const mesh = new THREE.Mesh(projGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.projectiles.push({
        active: false,
        fromPlayer: true,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        radius: 1.5,
        life: 0,
        damage: 0,
        isCrit: false,
        mesh,
      });
    }

    const waveGeo = new THREE.RingGeometry(0.75, 1.0, 28);
    waveGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#fbbf24',
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(waveGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shockwaves.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        radius: 0.5,
        maxRadius: 5,
        life: 0,
        maxLife: 0.4,
        mesh,
      });
    }

    const particleCount = 180;
    const partGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
    const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInst = new THREE.InstancedMesh(partGeo, partMat, particleCount);
    this.particleInst.frustumCulled = false;
    for (let i = 0; i < particleCount; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.5,
        scale: 0,
        r: 1,
        g: 1,
        b: 1,
      });
      _dummyObj.position.set(0, -100, 0);
      _dummyObj.scale.set(0, 0, 0);
      _dummyObj.updateMatrix();
      this.particleInst.setMatrixAt(i, _dummyObj.matrix);
      this.particleInst.setColorAt(i, _colorScratch.setRGB(1, 1, 1));
    }
    this.scene.add(this.particleInst);

    // Spawn initial open-world enemies
    this.populateEnemies();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Event listeners & ResizeObserver
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(mountEl);

    // Start loop
    this.lastTimeMs = performance.now();
    this.emitHudSnapshot(true);
    this.scheduleNextFrame();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: true });
    dom.addEventListener('contextmenu', this.onContextMenu);
  }

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onWindowBlur = (): void => {
    this.keysHeld.clear();
    this.isDraggingCamera = false;
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.keysHeld.clear();
      this.isDraggingCamera = false;
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // Ignore when typing in input/textarea
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const code = e.code;
    const isFreshPress = !this.keysHeld.has(code);
    this.keysHeld.add(code);

    if (this.phase !== 'playing') return;

    if (code === 'Space' && isFreshPress) {
      e.preventDefault();
      this.jumpBufferTimer = 0.13;
    } else if (code === 'Digit1' && isFreshPress) {
      this.castSkill(0);
    } else if (code === 'Digit2' && isFreshPress) {
      this.castSkill(1);
    } else if (code === 'Digit3' && isFreshPress) {
      this.castSkill(2);
    } else if (code === 'Digit4' && isFreshPress) {
      this.castSkill(3);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
    if (e.code === 'Space' && this.pvy > 2.5) {
      this.pvy *= 0.45; // Variable jump cut
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.phase !== 'playing') return;
    if (e.button === 2 || e.button === 1 || e.shiftKey) {
      this.isDraggingCamera = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      return;
    }
    if (e.button === 0) {
      // Allow drag-orbit if moved, or basic attack on click
      this.isDraggingCamera = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.castSkill(0);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDraggingCamera || this.phase !== 'playing') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.camYaw -= dx * 0.0055;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.0045, 0.16, 0.92);
  };

  private onPointerUp = (): void => {
    this.isDraggingCamera = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.phase !== 'playing') return;
    this.camDistance = THREE.MathUtils.clamp(this.camDistance + e.deltaY * 0.008, 7.5, 22);
  };

  private handleResize(): void {
    const w = Math.max(1, this.mountEl.clientWidth || window.innerWidth);
    const h = Math.max(1, this.mountEl.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  public setPhase(nextPhase: GamePhase): void {
    this.phase = nextPhase;
    this.keysHeld.clear();
    this.isDraggingCamera = false;
    if (nextPhase === 'playing') {
      // Align camera cleanly behind the hero facing Solara Citadel
      this.camYaw = this.pyaw - Math.PI;
      this.defeatPendingTimer = 0;
    }
  }

  public updateProfile(profile: PlayerProfile, rebuildMesh = false): void {
    const appearanceChanged =
      rebuildMesh ||
      profile.classId !== this.playerProfile.classId ||
      profile.lineageId !== this.playerProfile.lineageId;

    this.playerProfile = { ...profile };
    const nextStats = computeCharacterStats(
      profile.classId,
      profile.lineageId,
      profile.level,
      profile.cultivationTier,
      profile.skillRanks
    );

    const hpRatio = this.playerStats.maxHp > 0 ? this.hp / this.playerStats.maxHp : 1;
    const manaRatio = this.playerStats.maxMana > 0 ? this.mana / this.playerStats.maxMana : 1;
    this.playerStats = nextStats;
    this.hp = Math.max(1, Math.min(nextStats.maxHp, Math.round(nextStats.maxHp * Math.max(0.2, hpRatio))));
    this.mana = Math.min(nextStats.maxMana, Math.round(nextStats.maxMana * Math.max(0.25, manaRatio)));
    this.stamina = Math.min(nextStats.maxStamina, this.stamina);

    if (appearanceChanged) {
      this.scene.remove(this.playerRig.root);
      this.playerRig = createHeroRig(profile.classId, profile.lineageId, this.textures.contactShadow);
      this.playerRig.root.position.set(this.px, this.py, this.pz);
      this.playerRig.root.rotation.y = this.pyaw;
      this.scene.add(this.playerRig.root);
    }
    this.emitHudSnapshot(true);
  }

  public healVitals(hpPct: number, manaPct: number): void {
    if (hpPct > 0) {
      const gained = Math.round(this.playerStats.maxHp * hpPct);
      this.hp = Math.min(this.playerStats.maxHp, this.hp + gained);
      this.spawnParticles(this.px, this.py + 1.4, this.pz, '#34d399', 14, 4.2);
      this.emitFloatingNumber(this.px, this.py + 2.6, this.pz, gained, false, true, 'HEAL');
      this.audio.playCast('heal');
    }
    if (manaPct > 0) {
      const gained = Math.round(this.playerStats.maxMana * manaPct);
      this.mana = Math.min(this.playerStats.maxMana, this.mana + gained);
      this.spawnParticles(this.px, this.py + 1.4, this.pz, '#38bdf8', 12, 3.8);
      this.audio.playCast('ice');
    }
    this.emitHudSnapshot(true);
  }

  public respawnPlayer(): void {
    this.px = 0;
    this.pz = 14;
    this.py = terrainHeightAt(this.px, this.pz);
    this.pvx = 0;
    this.pvy = 0;
    this.pvz = 0;
    this.pyaw = Math.PI;
    this.camYaw = 0;
    this.hp = this.playerStats.maxHp;
    this.mana = this.playerStats.maxMana;
    this.stamina = this.playerStats.maxStamina;
    this.skillCooldowns = [0, 0, 0, 0];
    this.combo = 0;
    this.comboTimer = 0;
    this.defeatPendingTimer = 0;
    this.playerRig.root.position.set(this.px, this.py, this.pz);
    this.playerRig.root.rotation.set(0, this.pyaw, 0);
    this.spawnShockwave(this.px, this.py + 0.1, this.pz, 4.5, '#fbbf24');
    this.emitHudSnapshot(true);
  }

  public syncRemotePlayers(peers: RemotePlayerState[], localPlayerId: string): void {
    const activeIds = new Set<string>();
    for (const peer of peers) {
      if (peer.playerId === localPlayerId) continue;
      activeIds.add(peer.playerId);
      const existing = this.remoteAvatars.get(peer.playerId);
      if (!existing || existing.classId !== peer.classId || existing.lineageId !== peer.lineageId) {
        if (existing) {
          this.scene.remove(existing.rig.root);
        }
        const rig = createHeroRig(peer.classId, peer.lineageId, this.textures.contactShadow);
        const gy = terrainHeightAt(peer.x, peer.z);
        rig.root.position.set(peer.x, gy, peer.z);
        rig.root.rotation.y = peer.yaw;
        this.scene.add(rig.root);
        this.remoteAvatars.set(peer.playerId, {
          rig,
          classId: peer.classId,
          lineageId: peer.lineageId,
          x: peer.x,
          y: gy,
          z: peer.z,
          yaw: peer.yaw,
          targetX: peer.x,
          targetY: gy,
          targetZ: peer.z,
          targetYaw: peer.yaw,
          walkPhase: 0,
          state: peer,
        });
      } else {
        existing.targetX = peer.x;
        existing.targetY = terrainHeightAt(peer.x, peer.z);
        existing.targetZ = peer.z;
        existing.targetYaw = peer.yaw;
        existing.state = peer;
      }
    }

    for (const [id, entry] of this.remoteAvatars.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.rig.root);
        this.remoteAvatars.delete(id);
      }
    }
  }

  private populateEnemies(): void {
    const spawnPlan: Array<{ archetype: EnemyArchetypeId; x: number; z: number; levelOffset: number }> = [
      // Approachable vanguard patrols near Solara Avenue (within immediate combat reach)
      { archetype: 'marauder', x: -9, z: 2, levelOffset: 0 },
      { archetype: 'marauder', x: 10, z: 4, levelOffset: 0 },
      { archetype: 'shade_archer', x: -15, z: -6, levelOffset: 0 },
      { archetype: 'marauder', x: 16, z: -8, levelOffset: 0 },
      // Verdant Forest (NW)
      { archetype: 'shade_archer', x: -32, z: -18, levelOffset: 1 },
      { archetype: 'shade_archer', x: -46, z: -14, levelOffset: 1 },
      { archetype: 'marauder', x: -36, z: -36, levelOffset: 1 },
      // Ironforge Crags (NE)
      { archetype: 'juggernaut', x: 34, z: -16, levelOffset: 1 },
      { archetype: 'marauder', x: 48, z: -12, levelOffset: 1 },
      { archetype: 'juggernaut', x: 36, z: -34, levelOffset: 2 },
      // Shadowvale Cursed Wastes (South)
      { archetype: 'shade_archer', x: -14, z: 36, levelOffset: 1 },
      { archetype: 'juggernaut', x: 14, z: 38, levelOffset: 2 },
      { archetype: 'dreadlord_boss', x: 0, z: 39, levelOffset: 3 },
    ];

    for (const item of spawnPlan) {
      this.spawnEnemy(item.archetype, item.x, item.z, item.levelOffset);
    }
  }

  private spawnEnemy(archetype: EnemyArchetypeId, x: number, z: number, levelOffset = 0): void {
    const spec = ENEMY_ARCHETYPES[archetype];
    const level = Math.max(1, this.playerProfile.level + levelOffset);
    const scale = 1 + (level - 1) * 0.14;
    const rig = createEnemyRig(archetype, this.textures.contactShadow);
    const y = terrainHeightAt(x, z);
    rig.root.position.set(x, y, z);
    this.scene.add(rig.root);

    this.enemies.push({
      id: `enemy_${this.enemyIdCounter++}`,
      archetype,
      level,
      rig,
      x,
      y,
      z,
      vx: 0,
      vz: 0,
      yaw: Math.random() * Math.PI * 2,
      homeX: x,
      homeZ: z,
      patrolAngle: Math.random() * Math.PI * 2,
      hp: Math.round(spec.baseHp * scale),
      maxHp: Math.round(spec.baseHp * scale),
      attack: Math.round(spec.baseAttack * scale),
      defense: Math.round(spec.baseDefense * scale),
      aiState: 'patrol',
      stateTimer: 0,
      attackCooldown: 0.6 + Math.random() * 0.8,
      hitFlashTimer: 0,
      koTimer: 0,
      walkPhase: Math.random() * 6,
      statuses: {},
      dotAccum: 0,
    });
  }

  public castSkill(slotIndex: 0 | 1 | 2 | 3): boolean {
    if (this.phase !== 'playing' || this.defeatPendingTimer > 0) return false;
    const effective = computeEffectiveSkill(
      this.playerProfile.classId,
      slotIndex,
      this.playerProfile.skillRanks
    );
    const skill = effective.skill;
    if (!skill) return false;
    if (this.skillCooldowns[slotIndex] > 0) return false;
    if (this.mana < effective.manaCost) return false;

    this.mana -= effective.manaCost;
    this.skillCooldowns[slotIndex] = effective.cooldown;
    this.attackAnimTimer = 0.28;
    this.attackSwingDir *= -1;

    // Auto-face nearest enemy in range if one is nearby so combat feels crisp
    let nearest: ActiveEnemy | null = null;
    let nearestDist = Math.max(skill.range + 4, 14);
    for (const enemy of this.enemies) {
      if (enemy.aiState === 'ko') continue;
      const dist = Math.hypot(enemy.x - this.px, enemy.z - this.pz);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    }
    if (nearest) {
      this.pyaw = Math.atan2(nearest.x - this.px, nearest.z - this.pz);
      this.lockedTargetId = nearest.id;
    }

    const fwdX = Math.sin(this.pyaw);
    const fwdZ = Math.cos(this.pyaw);

    // Optional dash impulse
    if (skill.isDash) {
      this.pvx += fwdX * 18;
      this.pvz += fwdZ * 18;
      this.spawnParticles(this.px, this.py + 1.0, this.pz, skill.accentHex, 14, 5.2);
    }

    // Optional self-heal / ward component
    if (skill.isHeal) {
      const healAmt = Math.round(this.playerStats.maxHp * (0.24 + effective.rank * 0.04));
      this.hp = Math.min(this.playerStats.maxHp, this.hp + healAmt);
      this.emitFloatingNumber(this.px, this.py + 2.5, this.pz, healAmt, false, true, 'WARD');
      this.audio.playCast('heal');
    }

    if (skill.isProjectile) {
      this.audio.playCast(
        skill.statusEffect === 'freeze'
          ? 'ice'
          : skill.statusEffect === 'burn'
          ? 'fire'
          : skill.statusEffect === 'poison'
          ? 'venom'
          : 'storm'
      );
      this.spawnProjectile({
        fromPlayer: true,
        x: this.px + fwdX * 1.1,
        y: this.py + 1.5,
        z: this.pz + fwdZ * 1.1,
        vx: fwdX * 26,
        vy: 0,
        vz: fwdZ * 26,
        radius: effective.radius,
        damageMult: effective.damageMult,
        statusEffect: skill.statusEffect,
        colorHex: skill.accentHex,
      });
    } else {
      this.audio.playSwing(slotIndex >= 2);
      const hitCenterX = effective.radius >= 5 ? this.px : this.px + fwdX * (skill.range * 0.55);
      const hitCenterZ = effective.radius >= 5 ? this.pz : this.pz + fwdZ * (skill.range * 0.55);
      this.spawnShockwave(hitCenterX, terrainHeightAt(hitCenterX, hitCenterZ) + 0.15, hitCenterZ, effective.radius, skill.accentHex);

      let hitAny = false;
      for (const enemy of this.enemies) {
        if (enemy.aiState === 'ko') continue;
        const dist = Math.hypot(enemy.x - hitCenterX, enemy.z - hitCenterZ);
        if (dist <= effective.radius + (enemy.archetype === 'dreadlord_boss' ? 1.5 : 0.85)) {
          this.applyPlayerHitToEnemy(enemy, effective.damageMult, skill.statusEffect, skill.accentHex);
          hitAny = true;
        }
      }
      if (hitAny && slotIndex >= 2) {
        this.hitstopTimer = 0.048;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.35);
      }
    }

    this.emitHudSnapshot(true);
    return true;
  }

  private applyPlayerHitToEnemy(
    enemy: ActiveEnemy,
    damageMult: number,
    statusEffect: StatusEffectType | undefined,
    accentHex: string
  ): void {
    const cls = CHARACTER_CLASSES[this.playerProfile.classId];
    const enemySpec = ENEMY_ARCHETYPES[enemy.archetype];
    const isCrit = Math.random() < this.playerStats.critChance;

    const dmg = computeCombatDamage({
      attackerAttack: this.playerStats.attack,
      skillMultiplier: damageMult,
      targetDefense: enemy.defense,
      isCrit,
      attackerBranch: cls.branch,
      defenderBranch: enemySpec.branch,
      comboCount: this.combo,
      realmDiff: this.playerProfile.cultivationTier,
    });

    enemy.hp = Math.max(0, enemy.hp - dmg.finalDamage);
    enemy.hitFlashTimer = 0.065;
    this.sessionDamageDealt += dmg.finalDamage;
    this.combo += 1;
    this.comboTimer = 3.2;
    this.lockedTargetId = enemy.id;

    // Knockback impulse away from player
    const dx = enemy.x - this.px;
    const dz = enemy.z - this.pz;
    const len = Math.hypot(dx, dz) || 1;
    const kb = enemy.archetype === 'dreadlord_boss' ? 2.5 : 6.8;
    enemy.vx += (dx / len) * kb;
    enemy.vz += (dz / len) * kb;

    if (statusEffect) {
      enemy.statuses[statusEffect] = statusEffect === 'stun' ? 1.6 : 4.2;
    }

    this.audio.playHit(isCrit);
    this.spawnParticles(enemy.x, enemy.y + 1.4, enemy.z, isCrit ? '#fde047' : accentHex, isCrit ? 16 : 9, 5.5);
    this.emitFloatingNumber(
      enemy.x,
      enemy.y + (enemy.archetype === 'dreadlord_boss' ? 4.2 : 2.5),
      enemy.z,
      dmg.finalDamage,
      isCrit,
      false,
      dmg.branchMultiplier > 1 ? 'COUNTER' : undefined
    );

    if (isCrit) {
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.042);
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.24);
    }

    if (enemy.hp <= 0) {
      enemy.aiState = 'ko';
      enemy.koTimer = 0.45;
      this.sessionKills += 1;
      this.hitstopTimer = 0.06;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.42);
      this.spawnParticles(enemy.x, enemy.y + 1.6, enemy.z, enemySpec.accentHex, 22, 6.8);

      const killedBoss = Boolean(enemySpec.isBoss);
      if (killedBoss) {
        this.bossDefeated = true;
      }

      this.callbacks.onRewardEarned({
        xp: enemySpec.xpReward,
        gold: enemySpec.goldReward,
        spiritStones: enemySpec.spiritStoneReward,
        killedBoss,
        enemyName: enemySpec.name,
      });
    }
  }

  private spawnProjectile(opts: {
    fromPlayer: boolean;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    radius: number;
    damageMult: number;
    statusEffect?: StatusEffectType;
    colorHex: string;
    flatDamage?: number;
  }): void {
    const slot = this.projectiles.find((p) => !p.active);
    if (!slot) return;
    slot.active = true;
    slot.fromPlayer = opts.fromPlayer;
    slot.x = opts.x;
    slot.y = opts.y;
    slot.z = opts.z;
    slot.vx = opts.vx;
    slot.vy = opts.vy;
    slot.vz = opts.vz;
    slot.radius = opts.radius;
    slot.life = 1.45;
    slot.damage = opts.flatDamage ?? opts.damageMult;
    slot.isCrit = false;
    slot.statusEffect = opts.statusEffect;

    const mat = slot.mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(opts.colorHex);
    mat.emissive.set(opts.colorHex);
    slot.mesh.position.set(opts.x, opts.y, opts.z);
    slot.mesh.visible = true;
  }

  private spawnShockwave(x: number, y: number, z: number, maxRadius: number, colorHex: string): void {
    const slot = this.shockwaves.find((s) => !s.active);
    if (!slot) return;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.radius = 0.5;
    slot.maxRadius = maxRadius;
    slot.maxLife = 0.36;
    slot.life = 0.36;
    const mat = slot.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(colorHex);
    mat.opacity = 0.85;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(0.5);
    slot.mesh.visible = true;
  }

  private spawnParticles(x: number, y: number, z: number, colorHex: string, count: number, speed: number): void {
    _colorScratch.set(colorHex);
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % this.particles.length;
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.35 + Math.random() * 0.65) * speed;
      slot.active = true;
      slot.x = x + (Math.random() - 0.5) * 0.4;
      slot.y = y + (Math.random() - 0.5) * 0.4;
      slot.z = z + (Math.random() - 0.5) * 0.4;
      slot.vx = Math.cos(ang) * spd;
      slot.vy = 1.6 + Math.random() * 4.2;
      slot.vz = Math.sin(ang) * spd;
      slot.maxLife = 0.35 + Math.random() * 0.35;
      slot.life = slot.maxLife;
      slot.scale = 0.7 + Math.random() * 0.8;
      slot.r = _colorScratch.r;
      slot.g = _colorScratch.g;
      slot.b = _colorScratch.b;
    }
  }

  private emitFloatingNumber(
    wx: number,
    wy: number,
    wz: number,
    amount: number,
    isCrit: boolean,
    isHeal = false,
    label?: string
  ): void {
    _vec3A.set(wx, wy, wz).project(this.camera);
    if (_vec3A.z < -1 || _vec3A.z > 1) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const screenX = ((_vec3A.x + 1) * 0.5) * rect.width;
    const screenY = ((1 - _vec3A.y) * 0.5) * rect.height;
    this.callbacks.onFloatingDamage({
      id: this.floatingDmgId++,
      screenX,
      screenY,
      amount,
      isCrit,
      isHeal,
      label,
    });
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(() => this.tick(), 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastTimeMs) / 1000;
    this.lastTimeMs = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    // Real-time visual juice ticks even during sim hitstop
    if (this.cameraTrauma > 0) {
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.8);
    }
    this.updateAmbientWorld(dt);

    if (this.phase === 'playing') {
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      } else {
        this.elapsedPlayingSeconds += dt;
        this.updatePlayer(dt);
        this.updateEnemies(dt);
        this.updateProjectiles(dt);
      }
      this.updateShockwaves(dt);
      this.updateParticles(dt);
      this.updateRemoteAvatars(dt);
      this.updateGameplayCamera(dt);

      this.hudEmitAccum += dt;
      if (this.hudEmitAccum >= 0.12) {
        this.hudEmitAccum = 0;
        this.emitHudSnapshot(false);
        this.emitPeerLabels();
      }

      this.netEmitAccum += dt;
      if (this.netEmitAccum >= 0.16) {
        this.netEmitAccum = 0;
        this.callbacks.onPositionBroadcast({
          x: Number(this.px.toFixed(2)),
          y: Number(this.py.toFixed(2)),
          z: Number(this.pz.toFixed(2)),
          yaw: Number(this.pyaw.toFixed(2)),
          hp: Math.round(this.hp),
          maxHp: Math.round(this.playerStats.maxHp),
          attacking: this.attackAnimTimer > 0,
        });
      }
    } else if (this.phase === 'title') {
      this.updateTitleTour(dt);
      this.updateParticles(dt);
    }

    this.renderer.render(this.scene, this.camera);
    this.scheduleNextFrame();
  }

  private updateAmbientWorld(dt: number): void {
    // 120-second smooth Day/Night fantasy sky cycle
    this.timeOfDay = (this.timeOfDay + dt / 120) % 1;
    const sunAngle = this.timeOfDay * Math.PI * 2;
    const sunElev = Math.sin(sunAngle);

    this.sunLight.position.set(
      Math.cos(sunAngle) * 62,
      Math.max(14, 24 + sunElev * 48),
      Math.sin(sunAngle) * 38 + 18
    );

    if (sunElev > 0.2) {
      _currentSky.copy(_daySky);
      this.sunLight.intensity = 2.05;
      this.hemiLight.intensity = 0.88;
    } else if (sunElev > -0.15) {
      const t = (sunElev + 0.15) / 0.35;
      _currentSky.copy(_duskSky).lerp(_daySky, t);
      this.sunLight.intensity = 1.15 + t * 0.9;
      this.hemiLight.intensity = 0.62 + t * 0.25;
    } else {
      const t = Math.min(1, (-sunElev - 0.15) / 0.45);
      _currentSky.copy(_duskSky).lerp(_nightSky, t);
      this.sunLight.intensity = 0.82;
      this.hemiLight.intensity = 0.55;
    }

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(_currentSky);
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(_currentSky);
    }

    const tSec = this.lastTimeMs * 0.001;
    for (let i = 0; i < this.animatedCrystals.length; i++) {
      const c = this.animatedCrystals[i];
      c.rotation.y += dt * 1.1;
      c.position.y += Math.sin(tSec * 2.2 + i) * dt * 0.25;
    }
    for (let i = 0; i < this.banners.length; i++) {
      this.banners[i].rotation.z = Math.sin(tSec * 2.4 + i) * 0.06;
    }
    this.beaconLight.intensity = 16 + Math.sin(tSec * 3.1) * 3.5;
  }

  private updateTitleTour(dt: number): void {
    this.tourAngle += dt * 0.16;
    const radius = 34;
    const cx = Math.sin(this.tourAngle) * radius;
    const cz = -12 + Math.cos(this.tourAngle) * radius;
    const cy = 15.5 + Math.sin(this.tourAngle * 1.5) * 2.2;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(0, 7.5, -20);

    // Subtle idle breathing on hero rig
    const t = this.lastTimeMs * 0.002;
    this.playerRig.bodyPivot.position.y = Math.sin(t) * 0.05;
    this.playerRig.auraRing.rotation.z += dt * 0.8;
  }

  private updatePlayer(dt: number): void {
    // Handle brief defeat animation beat
    if (this.defeatPendingTimer > 0) {
      this.defeatPendingTimer -= dt;
      this.playerRig.bodyPivot.rotation.x = THREE.MathUtils.damp(
        this.playerRig.bodyPivot.rotation.x,
        -Math.PI / 2,
        10,
        dt
      );
      if (this.defeatPendingTimer <= 0) {
        this.callbacks.onPlayerDefeated({
          kills: this.sessionKills,
          damageDealt: this.sessionDamageDealt,
          elapsedSeconds: this.elapsedPlayingSeconds,
          bossDefeated: this.bossDefeated,
        });
      }
      return;
    }

    // Cooldowns, regen, combo decay
    for (let i = 0; i < 4; i++) {
      if (this.skillCooldowns[i] > 0) {
        this.skillCooldowns[i] = Math.max(0, this.skillCooldowns[i] - dt);
      }
    }
    this.mana = Math.min(this.playerStats.maxMana, this.mana + dt * 7.5);
    if (this.combo > 0) {
      const nextCombo = stepComboTimer(this.combo, this.comboTimer, dt);
      this.combo = nextCombo.combo;
      this.comboTimer = nextCombo.comboTimer;
    }

    // Read WASD + Arrow keys
    let moveFwd = 0;
    let moveRight = 0;
    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) moveFwd += 1;
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) moveFwd -= 1;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) moveRight += 1;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) moveRight -= 1;

    const moving = moveFwd !== 0 || moveRight !== 0;
    const wantsSprint = (this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight')) && moving && this.stamina > 6;
    const speedMult = wantsSprint ? 1.48 : 1.0;

    if (wantsSprint) {
      this.stamina = Math.max(0, this.stamina - dt * 24);
    } else {
      this.stamina = Math.min(this.playerStats.maxStamina, this.stamina + dt * 18);
    }

    // Camera-relative planar axes
    const camFwdX = -Math.sin(this.camYaw);
    const camFwdZ = -Math.cos(this.camYaw);
    const camRightX = Math.cos(this.camYaw);
    const camRightZ = -Math.sin(this.camYaw);

    let dirX = camFwdX * moveFwd + camRightX * moveRight;
    let dirZ = camFwdZ * moveFwd + camRightZ * moveRight;
    const dirLen = Math.hypot(dirX, dirZ);
    if (dirLen > 0.001) {
      dirX /= dirLen;
      dirZ /= dirLen;
    }

    const targetVx = dirX * this.playerStats.moveSpeed * speedMult;
    const targetVz = dirZ * this.playerStats.moveSpeed * speedMult;
    this.pvx = THREE.MathUtils.damp(this.pvx, targetVx, 11, dt);
    this.pvz = THREE.MathUtils.damp(this.pvz, targetVz, 11, dt);

    // Coyote time & buffered jump
    if (this.grounded) {
      this.coyoteTimer = 0.11;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }
    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
      if (this.coyoteTimer > 0) {
        this.pvy = 11.8;
        this.grounded = false;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.squashX = 0.84;
        this.squashY = 1.2;
        this.audio.playJump();
        this.spawnParticles(this.px, this.py + 0.15, this.pz, '#e2e8f0', 6, 2.8);
      }
    }

    // Gravity & horizontal integration
    this.pvy -= 28 * dt;
    this.px += this.pvx * dt;
    this.pz += this.pvz * dt;
    this.py += this.pvy * dt;

    // Resolve natural world boundary (84m open playable valley) & obstacle colliders
    const radialDist = Math.hypot(this.px, this.pz);
    if (radialDist > 84) {
      const k = 84 / radialDist;
      this.px *= k;
      this.pz *= k;
    }
    for (const c of this.colliders) {
      const dx = this.px - c.x;
      const dz = this.pz - c.z;
      const minDist = c.radius + 0.65;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDist * minDist && dSq > 0.0001) {
        const d = Math.sqrt(dSq);
        const push = minDist - d;
        this.px += (dx / d) * push;
        this.pz += (dz / d) * push;
      }
    }

    const groundY = terrainHeightAt(this.px, this.pz);
    if (this.py <= groundY) {
      if (!this.grounded && this.pvy < -4) {
        this.squashX = 1.22;
        this.squashY = 0.78;
      }
      this.py = groundY;
      this.pvy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // Facing rotation synced to movement unless mid-attack
    const horizSpeed = Math.hypot(this.pvx, this.pvz);
    if (dirLen > 0.1 && this.attackAnimTimer <= 0) {
      const targetYaw = Math.atan2(dirX, dirZ);
      let diff = targetYaw - this.pyaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.pyaw += diff * (1 - Math.exp(-14 * dt));
    }

    // Gait cycle synced to actual distance traveled (no skating)
    this.walkPhase += horizSpeed * dt * 1.45;
    const stride = this.grounded ? Math.min(1, horizSpeed / 7) : 0.15;
    this.playerRig.leftLeg.rotation.x = Math.sin(this.walkPhase) * 0.72 * stride;
    this.playerRig.rightLeg.rotation.x = -Math.sin(this.walkPhase) * 0.72 * stride;

    // Attack swing animation
    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer = Math.max(0, this.attackAnimTimer - dt);
      const prog = 1 - this.attackAnimTimer / 0.28;
      this.playerRig.rightArm.rotation.x = -Math.sin(prog * Math.PI) * 1.85;
      this.playerRig.rightArm.rotation.y = Math.sin(prog * Math.PI) * 0.85 * this.attackSwingDir;
    } else {
      this.playerRig.rightArm.rotation.x = -Math.sin(this.walkPhase) * 0.45 * stride;
      this.playerRig.rightArm.rotation.y = 0;
    }
    this.playerRig.leftArm.rotation.x = Math.sin(this.walkPhase) * 0.45 * stride;

    // Squash & stretch damping
    this.squashX = THREE.MathUtils.damp(this.squashX, 1, 14, dt);
    this.squashY = THREE.MathUtils.damp(this.squashY, 1, 14, dt);
    this.playerRig.bodyPivot.rotation.x = 0;
    this.playerRig.bodyPivot.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.08 * stride;
    const baseScale = this.playerRig.bodyPivot.scale;
    const linScale = this.playerProfile.lineageId === 'ironforge_dwarf' ? [1.14, 0.86, 1.12] : [1, 1, 1];
    baseScale.set(linScale[0] * this.squashX, linScale[1] * this.squashY, linScale[2] * this.squashX);

    // Hit flash
    this.updateRigFlash(this.playerRig, dt, this.hitFlashTimer > 0);
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    this.playerRig.root.position.set(this.px, this.py, this.pz);
    this.playerRig.root.rotation.y = this.pyaw;
    this.playerRig.auraRing.rotation.z += dt * 1.2;
  }

  private updateEnemies(dt: number): void {
    // Respawn replenishment if population drops below 11
    this.respawnTimer += dt;
    if (this.respawnTimer > 8.0 && this.enemies.length < 11) {
      this.respawnTimer = 0;
      const ang = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 28;
      const sx = Math.cos(ang) * dist;
      const sz = Math.sin(ang) * dist;
      const archetypes: EnemyArchetypeId[] = ['marauder', 'shade_archer', 'juggernaut'];
      const pick = archetypes[Math.floor(Math.random() * archetypes.length)];
      this.spawnEnemy(pick, sx, sz, 0);
    }

    // Attack token pool: at most 3 enemies telegraphing/attacking simultaneously
    let activeAttackers = 0;
    for (const e of this.enemies) {
      if (e.aiState === 'telegraph' || e.aiState === 'attack') activeAttackers++;
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const spec = ENEMY_ARCHETYPES[e.archetype];

      if (e.hitFlashTimer > 0) e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);
      this.updateRigFlash(e.rig, dt, e.hitFlashTimer > 0);

      // KO topple & dissolve
      if (e.aiState === 'ko') {
        e.koTimer -= dt;
        e.rig.bodyPivot.rotation.x = THREE.MathUtils.damp(e.rig.bodyPivot.rotation.x, -Math.PI / 2, 10, dt);
        const s = Math.max(0.01, e.koTimer / 0.45);
        e.rig.root.scale.setScalar(s);
        if (e.koTimer <= 0) {
          this.scene.remove(e.rig.root);
          if (this.lockedTargetId === e.id) this.lockedTargetId = null;
          this.enemies.splice(i, 1);
        }
        continue;
      }

      // Status effects (Burn, Poison, Freeze, Stun)
      let speedMod = 1.0;
      let stunned = false;
      for (const statusKey of Object.keys(e.statuses) as StatusEffectType[]) {
        const rem = (e.statuses[statusKey] ?? 0) - dt;
        if (rem <= 0) {
          delete e.statuses[statusKey];
        } else {
          e.statuses[statusKey] = rem;
          if (statusKey === 'freeze') speedMod *= 0.45;
          if (statusKey === 'stun') stunned = true;
        }
      }
      if (e.statuses.burn || e.statuses.poison) {
        e.dotAccum += dt;
        if (e.dotAccum >= 0.9) {
          e.dotAccum = 0;
          const dotDmg = Math.max(4, Math.round(this.playerStats.attack * 0.25));
          e.hp = Math.max(1, e.hp - dotDmg);
          this.emitFloatingNumber(e.x, e.y + 2.3, e.z, dotDmg, false, false, e.statuses.burn ? 'BURN' : 'POISON');
        }
      }

      if (e.attackCooldown > 0) e.attackCooldown = Math.max(0, e.attackCooldown - dt);

      const dx = this.px - e.x;
      const dz = this.pz - e.z;
      const distToPlayer = Math.hypot(dx, dz) || 0.001;

      if (!stunned) {
        const nextState = decideEnemyAIState({
          archetype: e.archetype,
          currentState: e.aiState,
          distanceToPlayer: distToPlayer,
          hpRatio: e.hp / e.maxHp,
          aggroRadius: spec.aggroRadius,
          attackRange: spec.attackRange,
          attackCooldownRemaining: e.attackCooldown,
          hasAttackToken: activeAttackers < 3,
        });

        if (nextState === 'telegraph' && e.aiState !== 'telegraph') {
          e.aiState = 'telegraph';
          e.stateTimer = spec.telegraphDuration;
          activeAttackers++;
          this.audio.playTelegraph();
        } else if (e.aiState !== 'telegraph' && e.aiState !== 'attack') {
          e.aiState = nextState;
        }
      }

      let moveX = 0;
      let moveZ = 0;
      const ringMat = e.rig.auraRing.material as THREE.MeshBasicMaterial;

      if (stunned) {
        ringMat.opacity = 0.25;
      } else if (e.aiState === 'telegraph') {
        e.stateTimer -= dt;
        e.yaw = Math.atan2(dx, dz);
        const pulse = 1 + (1 - e.stateTimer / spec.telegraphDuration) * 0.9;
        e.rig.auraRing.scale.setScalar(pulse);
        ringMat.opacity = 0.85;
        e.rig.rightArm.rotation.x = -1.6;
        if (e.stateTimer <= 0) {
          e.aiState = 'attack';
          e.stateTimer = 0.22;
          this.executeEnemyAttack(e, dx, dz, distToPlayer);
        }
      } else if (e.aiState === 'attack') {
        e.stateTimer -= dt;
        e.rig.rightArm.rotation.x = 0.85;
        ringMat.opacity = 0.3;
        e.rig.auraRing.scale.setScalar(1);
        if (e.stateTimer <= 0) {
          e.aiState = 'chase';
          e.attackCooldown = spec.attackCooldown;
        }
      } else if (e.aiState === 'chase') {
        moveX = (dx / distToPlayer) * spec.moveSpeed * speedMod;
        moveZ = (dz / distToPlayer) * spec.moveSpeed * speedMod;
        e.yaw = Math.atan2(dx, dz);
        ringMat.opacity = 0.22;
        e.rig.auraRing.scale.setScalar(1);
      } else if (e.aiState === 'kite' || e.aiState === 'flee') {
        moveX = -(dx / distToPlayer) * spec.moveSpeed * speedMod;
        moveZ = -(dz / distToPlayer) * spec.moveSpeed * speedMod;
        e.yaw = Math.atan2(moveX, moveZ);
        ringMat.opacity = 0.22;
      } else {
        // Gentle patrol around home point
        e.patrolAngle += dt * 0.45;
        const tx = e.homeX + Math.cos(e.patrolAngle) * 4.5;
        const tz = e.homeZ + Math.sin(e.patrolAngle) * 4.5;
        const pdx = tx - e.x;
        const pdz = tz - e.z;
        const pd = Math.hypot(pdx, pdz);
        if (pd > 0.4) {
          moveX = (pdx / pd) * spec.moveSpeed * 0.42;
          moveZ = (pdz / pd) * spec.moveSpeed * 0.42;
          e.yaw = Math.atan2(moveX, moveZ);
        }
        ringMat.opacity = 0.14;
      }

      e.vx = THREE.MathUtils.damp(e.vx, moveX, 8, dt);
      e.vz = THREE.MathUtils.damp(e.vz, moveZ, 8, dt);
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      e.y = terrainHeightAt(e.x, e.z);

      const spd = Math.hypot(e.vx, e.vz);
      e.walkPhase += spd * dt * 1.4;
      const stride = Math.min(1, spd / 5);
      e.rig.leftLeg.rotation.x = Math.sin(e.walkPhase) * 0.65 * stride;
      e.rig.rightLeg.rotation.x = -Math.sin(e.walkPhase) * 0.65 * stride;
      if (e.aiState !== 'telegraph' && e.aiState !== 'attack') {
        e.rig.rightArm.rotation.x = -Math.sin(e.walkPhase) * 0.4 * stride;
      }
      e.rig.root.position.set(e.x, e.y, e.z);
      e.rig.root.rotation.y = e.yaw;
    }
  }

  private executeEnemyAttack(e: ActiveEnemy, dx: number, dz: number, distToPlayer: number): void {
    const spec = ENEMY_ARCHETYPES[e.archetype];
    if (e.archetype === 'shade_archer') {
      const dirX = dx / distToPlayer;
      const dirZ = dz / distToPlayer;
      this.spawnProjectile({
        fromPlayer: false,
        x: e.x + dirX * 0.9,
        y: e.y + 1.5,
        z: e.z + dirZ * 0.9,
        vx: dirX * 19,
        vy: 0,
        vz: dirZ * 19,
        radius: 1.25,
        damageMult: 1,
        flatDamage: e.attack,
        colorHex: '#c084fc',
      });
    } else {
      const hitRadius = spec.attackRange + 0.9;
      this.spawnShockwave(e.x, e.y + 0.14, e.z, hitRadius, spec.accentHex);
      if (distToPlayer <= hitRadius && this.defeatPendingTimer <= 0) {
        this.applyEnemyHitToPlayer(e.attack, spec.branch);
      }
    }
  }

  private applyEnemyHitToPlayer(enemyAttack: number, enemyBranch: 'shieldbearer' | 'shooter' | 'bomber'): void {
    const cls = CHARACTER_CLASSES[this.playerProfile.classId];
    const dmg = computeCombatDamage({
      attackerAttack: enemyAttack,
      skillMultiplier: 1.0,
      targetDefense: this.playerStats.defense,
      isCrit: false,
      attackerBranch: enemyBranch,
      defenderBranch: cls.branch,
      comboCount: 0,
    });

    this.hp = Math.max(0, this.hp - dmg.finalDamage);
    this.hitFlashTimer = 0.085;
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);
    this.audio.playPlayerHurt();
    this.spawnParticles(this.px, this.py + 1.4, this.pz, '#ef4444', 10, 4.5);
    this.emitFloatingNumber(this.px, this.py + 2.5, this.pz, dmg.finalDamage, false, false, 'HIT');

    if (this.hp <= 0) {
      if (this.playerProfile.reviveTokens > 0) {
        this.hp = Math.round(this.playerStats.maxHp * 0.6);
        this.playerProfile.reviveTokens -= 1;
        this.spawnShockwave(this.px, this.py + 0.15, this.pz, 6.0, '#facc15');
        this.emitFloatingNumber(this.px, this.py + 2.8, this.pz, this.hp, true, true, 'REVIVED');
        this.audio.playLevelUp();
        this.callbacks.onReviveTokenUsed();
      } else {
        this.defeatPendingTimer = 0.55;
        this.audio.playDefeat();
      }
    }
    this.emitHudSnapshot(true);
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.y += dt * 9;
      p.mesh.rotation.x += dt * 6;

      let hit = false;
      if (p.fromPlayer) {
        for (const e of this.enemies) {
          if (e.aiState === 'ko') continue;
          const dist = Math.hypot(e.x - p.x, e.z - p.z);
          if (dist <= p.radius + (e.archetype === 'dreadlord_boss' ? 1.5 : 0.75)) {
            this.applyPlayerHitToEnemy(e, p.damage, p.statusEffect, '#38bdf8');
            if (p.radius > 3.2) {
              this.spawnShockwave(p.x, terrainHeightAt(p.x, p.z) + 0.15, p.z, p.radius, '#f97316');
            }
            hit = true;
            break;
          }
        }
      } else {
        const dist = Math.hypot(this.px - p.x, this.pz - p.z);
        if (dist <= 1.25 && this.defeatPendingTimer <= 0) {
          this.applyEnemyHitToPlayer(p.damage, 'shooter');
          hit = true;
        }
      }

      if (hit || p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
      }
    }
  }

  private updateShockwaves(dt: number): void {
    for (const s of this.shockwaves) {
      if (!s.active) continue;
      s.life -= dt;
      const t = 1 - Math.max(0, s.life) / s.maxLife;
      const curRadius = THREE.MathUtils.lerp(0.6, s.maxRadius, t);
      s.mesh.scale.setScalar(curRadius);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.78;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }

  private updateParticles(dt: number): void {
    let anyDirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyDirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _dummyObj.position.set(0, -100, 0);
        _dummyObj.scale.set(0, 0, 0);
        _dummyObj.updateMatrix();
        this.particleInst.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }
      p.vy -= 14 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const s = p.scale * (p.life / p.maxLife);
      _dummyObj.position.set(p.x, p.y, p.z);
      _dummyObj.rotation.set(p.life * 6, p.life * 4, 0);
      _dummyObj.scale.setScalar(s);
      _dummyObj.updateMatrix();
      this.particleInst.setMatrixAt(i, _dummyObj.matrix);
      this.particleInst.setColorAt(i, _colorScratch.setRGB(p.r, p.g, p.b));
    }
    if (anyDirty) {
      this.particleInst.instanceMatrix.needsUpdate = true;
      if (this.particleInst.instanceColor) {
        this.particleInst.instanceColor.needsUpdate = true;
      }
    }
  }

  private updateRemoteAvatars(dt: number): void {
    for (const entry of this.remoteAvatars.values()) {
      const dx = entry.targetX - entry.x;
      const dz = entry.targetZ - entry.z;
      const moveDist = Math.hypot(dx, dz);
      entry.x = THREE.MathUtils.damp(entry.x, entry.targetX, 9, dt);
      entry.y = THREE.MathUtils.damp(entry.y, entry.targetY, 9, dt);
      entry.z = THREE.MathUtils.damp(entry.z, entry.targetZ, 9, dt);
      let yawDiff = entry.targetYaw - entry.yaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      entry.yaw += yawDiff * (1 - Math.exp(-10 * dt));

      entry.walkPhase += Math.min(10, moveDist * 6) * dt * 1.3;
      const stride = Math.min(1, moveDist * 1.4);
      entry.rig.leftLeg.rotation.x = Math.sin(entry.walkPhase) * 0.65 * stride;
      entry.rig.rightLeg.rotation.x = -Math.sin(entry.walkPhase) * 0.65 * stride;
      entry.rig.root.position.set(entry.x, entry.y, entry.z);
      entry.rig.root.rotation.y = entry.yaw;
    }
  }

  private updateGameplayCamera(dt: number): void {
    _camTarget.set(this.px, this.py + 2.1, this.pz);
    const horizDist = Math.cos(this.camPitch) * this.camDistance;
    const vertOffset = Math.sin(this.camPitch) * this.camDistance + 1.4;

    const desiredX = this.px + Math.sin(this.camYaw) * horizDist;
    const desiredZ = this.pz + Math.cos(this.camYaw) * horizDist;
    const minGroundY = terrainHeightAt(desiredX, desiredZ) + 1.3;
    const desiredY = Math.max(minGroundY, this.py + vertOffset);

    _camDesired.set(desiredX, desiredY, desiredZ);
    const alpha = 1 - Math.exp(-10 * dt);
    this.camera.position.lerp(_camDesired, alpha);

    // Trauma-squared micro shake on heavy impacts
    if (this.cameraTrauma > 0.01) {
      const shake = this.cameraTrauma * this.cameraTrauma * 0.42;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }

    this.camera.lookAt(_camTarget);
  }

  private updateRigFlash(rig: AnimatedActorRig, _dt: number, active: boolean): void {
    for (let i = 0; i < rig.flashMaterials.length; i++) {
      const mat = rig.flashMaterials[i];
      if (active) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = 0.85;
      } else {
        mat.emissive.setHex(rig.baseEmissiveColors[i]);
        mat.emissiveIntensity = rig.baseEmissiveColors[i] === 0 ? 0 : 0.6;
      }
    }
  }

  private emitPeerLabels(): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const out: Array<{ id: string; name: string; tag: string | null; screenX: number; screenY: number; hpRatio: number }> = [];
    for (const [id, entry] of this.remoteAvatars.entries()) {
      _vec3B.set(entry.x, entry.y + 3.0, entry.z).project(this.camera);
      if (_vec3B.z < -1 || _vec3B.z > 1) continue;
      const sx = ((_vec3B.x + 1) * 0.5) * rect.width;
      const sy = ((1 - _vec3B.y) * 0.5) * rect.height;
      if (sx < -40 || sx > rect.width + 40 || sy < -40 || sy > rect.height + 40) continue;
      out.push({
        id,
        name: entry.state.name,
        tag: entry.state.guildTag,
        screenX: sx,
        screenY: sy,
        hpRatio: entry.state.maxHp > 0 ? entry.state.hp / entry.state.maxHp : 1,
      });
    }
    this.callbacks.onPeerLabelsUpdate(out);
  }

  private emitHudSnapshot(force: boolean): void {
    if (!force && this.disposed) return;

    let targetEnemy: HUDRuntimeSnapshot['targetEnemy'] = null;
    let chosen: ActiveEnemy | null = null;
    if (this.lockedTargetId) {
      chosen = this.enemies.find((e) => e.id === this.lockedTargetId && e.aiState !== 'ko') ?? null;
    }
    if (!chosen) {
      let bestDist = 24;
      for (const e of this.enemies) {
        if (e.aiState === 'ko') continue;
        const d = Math.hypot(e.x - this.px, e.z - this.pz);
        if (d < bestDist) {
          bestDist = d;
          chosen = e;
        }
      }
    }
    if (chosen) {
      const spec = ENEMY_ARCHETYPES[chosen.archetype];
      targetEnemy = {
        name: spec.name,
        archetype: chosen.archetype,
        level: chosen.level,
        hp: Math.round(chosen.hp),
        maxHp: Math.round(chosen.maxHp),
        branch: spec.branch,
        statuses: Object.keys(chosen.statuses) as StatusEffectType[],
      };
    }

    this.callbacks.onHudUpdate({
      hp: Math.round(this.hp),
      maxHp: Math.round(this.playerStats.maxHp),
      mana: Math.round(this.mana),
      maxMana: Math.round(this.playerStats.maxMana),
      stamina: Math.round(this.stamina),
      maxStamina: Math.round(this.playerStats.maxStamina),
      combo: this.combo,
      comboTimer: Number(this.comboTimer.toFixed(1)),
      biome: getBiomeAt(this.px, this.pz),
      timeOfDay: this.timeOfDay,
      x: Math.round(this.px),
      z: Math.round(this.pz),
      yaw: this.pyaw,
      skillCooldowns: [
        Number(this.skillCooldowns[0].toFixed(1)),
        Number(this.skillCooldowns[1].toFixed(1)),
        Number(this.skillCooldowns[2].toFixed(1)),
        Number(this.skillCooldowns[3].toFixed(1)),
      ],
      activeStatuses: [],
      targetEnemy,
      minimapEnemies: this.enemies
        .filter((e) => e.aiState !== 'ko')
        .map((e) => ({ x: e.x, z: e.z, isBoss: e.archetype === 'dreadlord_boss' })),
      minimapPeers: Array.from(this.remoteAvatars.values()).map((p) => ({
        x: p.x,
        z: p.z,
        name: p.state.name,
      })),
      bossDefeated: this.bossDefeated,
      sessionKills: this.sessionKills,
      sessionDamageDealt: this.sessionDamageDealt,
      elapsedSeconds: Math.round(this.elapsedPlayingSeconds),
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('contextmenu', this.onContextMenu);
    this.textures.dispose();
    this.renderer.dispose();
  }
}
