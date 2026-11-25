import * as THREE from 'three';
import { CHARACTER_CLASSES, ENEMY_ARCHETYPES, LINEAGES } from './catalog';
import { getBiomeAt, terrainHeightAt } from './rules';
import type { ProceduralTextureSet } from './textures';
import type { CharacterClassId, EnemyArchetypeId, LineageId } from './types';

export interface AnimatedActorRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  weaponPivot: THREE.Object3D;
  auraRing: THREE.Mesh;
  flashMaterials: THREE.MeshStandardMaterial[];
  baseEmissiveColors: number[];
}

export interface ObstacleCollider {
  x: number;
  z: number;
  radius: number;
}

export interface WorldBuildResult {
  worldGroup: THREE.Group;
  colliders: ObstacleCollider[];
  animatedCrystals: THREE.Object3D[];
  banners: THREE.Object3D[];
  beaconLight: THREE.PointLight;
}

/**
 * Builds a composite 10+ part procedural 3D character rig with class armor,
 * weapon silhouette, lineage traits (elf ears, dragon horns, kitsune tails,
 * void orbit crystals, dwarf beard, sovereign crest), and grounded contact shadow.
 */
export function createHeroRig(
  classId: CharacterClassId,
  lineageId: LineageId,
  contactShadowTex: THREE.CanvasTexture
): AnimatedActorRig {
  const cls = CHARACTER_CLASSES[classId];
  const lin = LINEAGES[lineageId];

  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  bodyPivot.scale.set(...lin.meshTraits.scale);
  root.add(bodyPivot);

  const flashMaterials: THREE.MeshStandardMaterial[] = [];
  const baseEmissiveColors: number[] = [];

  const registerMat = (params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
    const mat = new THREE.MeshStandardMaterial(params);
    flashMaterials.push(mat);
    baseEmissiveColors.push(mat.emissive.getHex());
    return mat;
  };

  const armorMat = registerMat({
    color: cls.primaryColor,
    roughness: 0.42,
    metalness: 0.55,
  });
  const trimMat = registerMat({
    color: lin.meshTraits.accentHex,
    roughness: 0.25,
    metalness: 0.82,
    emissive: new THREE.Color(lin.meshTraits.accentHex).multiplyScalar(0.14),
  });
  const clothMat = registerMat({
    color: '#1e2433',
    roughness: 0.85,
    metalness: 0.06,
  });
  const skinMat = registerMat({
    color: lin.meshTraits.skinHex,
    roughness: 0.72,
    metalness: 0.04,
  });
  const steelMat = registerMat({
    color: '#dbe4f0',
    roughness: 0.22,
    metalness: 0.88,
  });
  const glowMat = registerMat({
    color: cls.accentColor,
    roughness: 0.2,
    metalness: 0.3,
    emissive: new THREE.Color(cls.accentColor),
    emissiveIntensity: 0.75,
  });

  // Ground contact shadow disc
  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 20),
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.58,
    })
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.025;
  root.add(shadowDisc);

  // Subtle cultivation ground aura ring
  const auraRing = new THREE.Mesh(
    new THREE.RingGeometry(0.68, 0.84, 24),
    new THREE.MeshBasicMaterial({
      color: lin.meshTraits.accentHex,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  auraRing.rotation.x = -Math.PI / 2;
  auraRing.position.y = 0.04;
  root.add(auraRing);

  // Legs (pivoted at hip y = 0.85)
  const legGeo = new THREE.BoxGeometry(0.28, 0.8, 0.3);
  const bootGeo = new THREE.BoxGeometry(0.32, 0.26, 0.42);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.22, 0.85, 0);
  const leftLegMesh = new THREE.Mesh(legGeo, clothMat);
  leftLegMesh.position.y = -0.4;
  leftLegMesh.castShadow = true;
  const leftBoot = new THREE.Mesh(bootGeo, armorMat);
  leftBoot.position.set(0, -0.72, 0.05);
  leftLeg.add(leftLegMesh, leftBoot);
  bodyPivot.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.22, 0.85, 0);
  const rightLegMesh = new THREE.Mesh(legGeo, clothMat);
  rightLegMesh.position.y = -0.4;
  rightLegMesh.castShadow = true;
  const rightBoot = new THREE.Mesh(bootGeo, armorMat);
  rightBoot.position.set(0, -0.72, 0.05);
  rightLeg.add(rightLegMesh, rightBoot);
  bodyPivot.add(rightLeg);

  // Torso + chestplate + belt + cape
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.92, 0.46), armorMat);
  torso.position.y = 1.32;
  torso.castShadow = true;
  bodyPivot.add(torso);

  const chestCrest = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), trimMat);
  chestCrest.position.set(0, 1.42, 0.25);
  chestCrest.scale.set(1, 1.2, 0.4);
  bodyPivot.add(chestCrest);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.16, 0.5), trimMat);
  belt.position.y = 0.92;
  bodyPivot.add(belt);

  // Flowing cloak
  const cape = new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.12, 0.08), clothMat);
  cape.position.set(0, 1.22, -0.28);
  cape.rotation.x = 0.14;
  bodyPivot.add(cape);

  // Pauldrons (layered silhouette read)
  const pauldronGeo = new THREE.DodecahedronGeometry(0.26, 0);
  const leftPauldron = new THREE.Mesh(pauldronGeo, trimMat);
  leftPauldron.position.set(-0.52, 1.66, 0);
  const rightPauldron = new THREE.Mesh(pauldronGeo, trimMat);
  rightPauldron.position.set(0.52, 1.66, 0);
  bodyPivot.add(leftPauldron, rightPauldron);

  // Head + crown/hood/helmet
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 2.02, 0);
  bodyPivot.add(headGroup);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.52), skinMat);
  head.castShadow = true;
  headGroup.add(head);

  // Glowing visor / eyes
  const eyeGeo = new THREE.BoxGeometry(0.1, 0.06, 0.05);
  const leftEye = new THREE.Mesh(eyeGeo, glowMat);
  leftEye.position.set(-0.12, 0.03, 0.26);
  const rightEye = new THREE.Mesh(eyeGeo, glowMat);
  rightEye.position.set(0.12, 0.03, 0.26);
  headGroup.add(leftEye, rightEye);

  // Class headgear
  if (classId === 'knight') {
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.58), steelMat);
    helm.position.y = 0.16;
    const plume = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.42), trimMat);
    plume.position.set(0, 0.42, -0.05);
    headGroup.add(helm, plume);
  } else if (classId === 'mage') {
    const brim = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.14, 8), armorMat);
    brim.position.y = 0.28;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.66, 8), armorMat);
    spire.position.set(0, 0.62, -0.06);
    spire.rotation.x = -0.18;
    headGroup.add(brim, spire);
  } else if (classId === 'rogue') {
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.58, 0.62), clothMat);
    hood.position.set(0, 0.08, -0.05);
    headGroup.add(hood);
  } else {
    const circlet = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 6, 12), trimMat);
    circlet.rotation.x = Math.PI / 2;
    circlet.position.y = 0.22;
    const antlerL = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 5), trimMat);
    antlerL.position.set(-0.24, 0.42, 0);
    antlerL.rotation.z = 0.35;
    const antlerR = antlerL.clone();
    antlerR.position.x = 0.24;
    antlerR.rotation.z = -0.35;
    headGroup.add(circlet, antlerL, antlerR);
  }

  // Lineage-specific 3D traits
  if (lin.meshTraits.hasElfEars) {
    const earGeo = new THREE.ConeGeometry(0.07, 0.34, 4);
    const earL = new THREE.Mesh(earGeo, skinMat);
    earL.position.set(-0.34, 0.04, 0);
    earL.rotation.z = 1.25;
    const earR = new THREE.Mesh(earGeo, skinMat);
    earR.position.set(0.34, 0.04, 0);
    earR.rotation.z = -1.25;
    headGroup.add(earL, earR);
  }
  if (lin.meshTraits.hasRunicBeard) {
    const beard = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.24), trimMat);
    beard.position.set(0, -0.28, 0.22);
    headGroup.add(beard);
  }
  if (lin.meshTraits.hasDragonHorns) {
    const hornGeo = new THREE.ConeGeometry(0.08, 0.52, 6);
    const hL = new THREE.Mesh(hornGeo, trimMat);
    hL.position.set(-0.22, 0.42, -0.06);
    hL.rotation.set(-0.35, 0, 0.32);
    const hR = new THREE.Mesh(hornGeo, trimMat);
    hR.position.set(0.22, 0.42, -0.06);
    hR.rotation.set(-0.35, 0, -0.32);
    headGroup.add(hL, hR);
  }
  if (lin.meshTraits.hasKitsuneTails) {
    for (let i = -1; i <= 1; i++) {
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.92, 6), trimMat);
      tail.position.set(i * 0.22, 0.98, -0.52);
      tail.rotation.set(-0.95, 0, i * 0.38);
      bodyPivot.add(tail);
    }
  }
  if (lin.meshTraits.hasVoidCrystals) {
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), glowMat);
      const ang = (i / 3) * Math.PI * 2;
      shard.position.set(Math.cos(ang) * 0.72, 1.55 + (i % 2) * 0.22, Math.sin(ang) * 0.55 - 0.15);
      bodyPivot.add(shard);
    }
  }

  // Arms & class weapons
  const armGeo = new THREE.BoxGeometry(0.24, 0.72, 0.24);
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.52, 1.62, 0);
  const leftArmMesh = new THREE.Mesh(armGeo, armorMat);
  leftArmMesh.position.y = -0.32;
  leftArm.add(leftArmMesh);
  bodyPivot.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.52, 1.62, 0);
  const rightArmMesh = new THREE.Mesh(armGeo, armorMat);
  rightArmMesh.position.y = -0.32;
  rightArm.add(rightArmMesh);
  bodyPivot.add(rightArm);

  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0, -0.62, 0.16);
  rightArm.add(weaponPivot);

  if (cls.weaponStyle === 'sword_shield') {
    // Broadsword on right hand
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.1), trimMat);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.12), trimMat);
    guard.position.y = 0.14;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.35, 0.05), steelMat);
    blade.position.y = 0.84;
    blade.castShadow = true;
    weaponPivot.add(hilt, guard, blade);
    weaponPivot.rotation.x = Math.PI * 0.36;

    // Kite shield on left hand
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.92, 0.1), armorMat);
    shield.position.set(-0.18, -0.35, 0.24);
    const shieldRim = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.66, 0.12), trimMat);
    shieldRim.position.copy(shield.position);
    leftArm.add(shield, shieldRim);
  } else if (cls.weaponStyle === 'staff') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 2.0, 8), trimMat);
    shaft.position.y = 0.45;
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), glowMat);
    orb.position.y = 1.56;
    weaponPivot.add(shaft, orb);
    weaponPivot.rotation.x = Math.PI * 0.18;
  } else if (cls.weaponStyle === 'dual_daggers') {
    const daggerR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.88, 0.04), steelMat);
    daggerR.position.y = 0.42;
    const edgeR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.68, 0.05), glowMat);
    edgeR.position.y = 0.44;
    weaponPivot.add(daggerR, edgeR);
    weaponPivot.rotation.x = Math.PI * 0.42;

    const daggerL = daggerR.clone();
    daggerL.position.set(0, -0.62, 0.38);
    daggerL.rotation.x = Math.PI * 0.42;
    leftArm.add(daggerL);
  } else {
    // Spiritcaller Totem Mace
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.55, 8), clothMat);
    haft.position.y = 0.45;
    const totemHead = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), trimMat);
    totemHead.position.y = 1.28;
    const runeCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glowMat);
    runeCore.position.y = 1.56;
    weaponPivot.add(haft, totemHead, runeCore);
    weaponPivot.rotation.x = Math.PI * 0.26;
  }

  return {
    root,
    bodyPivot,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    weaponPivot,
    auraRing,
    flashMaterials,
    baseEmissiveColors,
  };
}

/**
 * Builds distinct multi-part silhouettes for the 4 enemy archetypes.
 */
export function createEnemyRig(
  archetype: EnemyArchetypeId,
  contactShadowTex: THREE.CanvasTexture
): AnimatedActorRig {
  const spec = ENEMY_ARCHETYPES[archetype];
  const scale = archetype === 'dreadlord_boss' ? 1.85 : archetype === 'juggernaut' ? 1.32 : archetype === 'shade_archer' ? 0.96 : 1.05;

  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  bodyPivot.scale.setScalar(scale);
  root.add(bodyPivot);

  const flashMaterials: THREE.MeshStandardMaterial[] = [];
  const baseEmissiveColors: number[] = [];

  const registerMat = (params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
    const mat = new THREE.MeshStandardMaterial(params);
    flashMaterials.push(mat);
    baseEmissiveColors.push(mat.emissive.getHex());
    return mat;
  };

  const darkArmor = registerMat({
    color: archetype === 'shade_archer' ? '#2e1d47' : archetype === 'juggernaut' ? '#3a231c' : '#252630',
    roughness: 0.52,
    metalness: 0.48,
  });
  const accentMat = registerMat({
    color: spec.accentHex,
    roughness: 0.25,
    metalness: 0.65,
    emissive: new THREE.Color(spec.accentHex),
    emissiveIntensity: 0.55,
  });
  const steelMat = registerMat({
    color: '#9ca3af',
    roughness: 0.3,
    metalness: 0.85,
  });

  // Contact shadow
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.95 * scale, 20),
    new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.025;
  root.add(shadow);

  // Telegraph ring (expanded & brightened when enemy winds up an attack)
  const auraRing = new THREE.Mesh(
    new THREE.RingGeometry(0.8 * scale, 1.05 * scale, 28),
    new THREE.MeshBasicMaterial({
      color: spec.accentHex,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  auraRing.rotation.x = -Math.PI / 2;
  auraRing.position.y = 0.05;
  root.add(auraRing);

  const legGeo = new THREE.BoxGeometry(0.3, 0.82, 0.32);
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.24, 0.84, 0);
  const lMesh = new THREE.Mesh(legGeo, darkArmor);
  lMesh.position.y = -0.4;
  leftLeg.add(lMesh);
  bodyPivot.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.24, 0.84, 0);
  const rMesh = new THREE.Mesh(legGeo, darkArmor);
  rMesh.position.y = -0.4;
  rightLeg.add(rMesh);
  bodyPivot.add(rightLeg);

  const torsoW = archetype === 'juggernaut' || archetype === 'dreadlord_boss' ? 1.02 : 0.72;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, 0.96, 0.52), darkArmor);
  torso.position.y = 1.34;
  torso.castShadow = true;
  bodyPivot.add(torso);

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), accentMat);
  core.position.set(0, 1.4, 0.28);
  bodyPivot.add(core);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), darkArmor);
  head.position.y = 2.06;
  bodyPivot.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.08), accentMat);
  visor.position.set(0, 2.06, 0.25);
  bodyPivot.add(visor);

  // Archetype-specific horns/crown/hood
  if (archetype === 'dreadlord_boss' || archetype === 'juggernaut') {
    const hornGeo = new THREE.ConeGeometry(0.1, 0.65, 6);
    const hornL = new THREE.Mesh(hornGeo, accentMat);
    hornL.position.set(-0.28, 2.48, 0);
    hornL.rotation.z = 0.42;
    const hornR = hornL.clone();
    hornR.position.x = 0.28;
    hornR.rotation.z = -0.42;
    bodyPivot.add(hornL, hornR);
  }
  if (archetype === 'dreadlord_boss') {
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 6, 8), accentMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 2.38;
    const shoulderSpikesL = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.75, 5), darkArmor);
    shoulderSpikesL.position.set(-0.72, 1.85, 0);
    shoulderSpikesL.rotation.z = 0.45;
    const shoulderSpikesR = shoulderSpikesL.clone();
    shoulderSpikesR.position.x = 0.72;
    shoulderSpikesR.rotation.z = -0.45;
    bodyPivot.add(crown, shoulderSpikesL, shoulderSpikesR);
  } else if (archetype === 'shade_archer') {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.65, 6), darkArmor);
    hood.position.set(0, 2.36, -0.05);
    bodyPivot.add(hood);
  }

  const leftArm = new THREE.Group();
  leftArm.position.set(-(torsoW * 0.5 + 0.16), 1.66, 0);
  const lArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.76, 0.26), darkArmor);
  lArmMesh.position.y = -0.34;
  leftArm.add(lArmMesh);
  bodyPivot.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(torsoW * 0.5 + 0.16, 1.66, 0);
  const rArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.76, 0.26), darkArmor);
  rArmMesh.position.y = -0.34;
  rightArm.add(rArmMesh);
  bodyPivot.add(rightArm);

  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0, -0.62, 0.18);
  rightArm.add(weaponPivot);

  if (archetype === 'shade_archer') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 12, Math.PI), accentMat);
    bow.rotation.z = -Math.PI / 2;
    bow.position.set(0, 0.1, 0.22);
    weaponPivot.add(bow);
  } else if (archetype === 'juggernaut') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.6, 6), steelMat);
    shaft.position.y = 0.5;
    const maulHead = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 0.42), accentMat);
    maulHead.position.y = 1.3;
    weaponPivot.add(shaft, maulHead);
    weaponPivot.rotation.x = Math.PI * 0.32;
  } else {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, archetype === 'dreadlord_boss' ? 1.85 : 1.25, 0.07), steelMat);
    blade.position.y = 0.75;
    const runeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.06, archetype === 'dreadlord_boss' ? 1.6 : 0.9, 0.09), accentMat);
    runeEdge.position.y = 0.75;
    weaponPivot.add(blade, runeEdge);
    weaponPivot.rotation.x = Math.PI * 0.34;
  }

  return {
    root,
    bodyPivot,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    weaponPivot,
    auraRing,
    flashMaterials,
    baseEmissiveColors,
  };
}

/**
 * Constructs the entire open-world fantasy landscape:
 * - Vertex-colored 4-biome terrain mesh (250m x 250m extending into natural mountain rim)
 * - Solara Citadel Keep (central multi-tower castle with crenelations, archway, banners, spire)
 * - 3 Regional Landmarks: Verdant Shrine (NW), Ironforge Watchtower (NE), Cursed Obelisk (S)
 * - Curved cobblestone paths connecting Citadel to Spawn and all 3 Biomes
 * - Instanced composite pine trees, boulders, and floating mana crystals
 */
export function buildOpenWorld(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean
): WorldBuildResult {
  const worldGroup = new THREE.Group();
  const colliders: ObstacleCollider[] = [];
  const animatedCrystals: THREE.Object3D[] = [];
  const banners: THREE.Object3D[] = [];

  // 1. Multi-biome sculpted terrain (240m x 240m)
  const terrainSize = 240;
  const segs = isSoftwareGl ? 76 : 96;
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);

  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const cTmp = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = terrainHeightAt(x, z);
    posAttr.setY(i, y);

    const biome = getBiomeAt(x, z);
    const distCenter = Math.hypot(x, z);

    if (distCenter > 92) {
      cTmp.set('#555d6e'); // Alpine slate rim
    } else if (biome === 'solara_plains') {
      cTmp.set('#4c7b42'); // Sunlit emerald meadow
    } else if (biome === 'verdant_forest') {
      cTmp.set('#2c5d3b'); // Deep pine moss
    } else if (biome === 'ironforge_crags') {
      cTmp.set('#6d5846'); // Runic ochre crag earth
    } else {
      cTmp.set('#3d344f'); // Shadowvale cursed violet-slate
    }

    // Road cobblestone tint along N-S and E-W avenues
    const onMainRoad = Math.abs(x) < 3.6 && z > -20 && z < 44;
    const onCrossRoad = Math.abs(z - 12) < 3.2 && Math.abs(x) < 42;
    if (onMainRoad || onCrossRoad) {
      cTmp.lerp(new THREE.Color('#8e8475'), 0.72);
    }

    // Subtle elevation shading
    const noiseTint = (Math.sin(x * 0.23) * Math.cos(z * 0.21)) * 0.045;
    cTmp.offsetHSL(0, 0, noiseTint + Math.min(0.08, y * 0.008));

    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }

  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  const terrainBump = textures.cobbleBump.clone();
  terrainBump.repeat.set(42, 42);
  terrainBump.needsUpdate = true;

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    bumpMap: terrainBump,
    bumpScale: 0.06,
    roughness: 0.92,
    metalness: 0.03,
  });
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  worldGroup.add(terrainMesh);

  // Shared PBR architectural materials
  const stoneTexColor = textures.stoneColor.clone();
  stoneTexColor.repeat.set(3, 2);
  stoneTexColor.needsUpdate = true;
  const stoneTexBump = textures.stoneBump.clone();
  stoneTexBump.repeat.set(3, 2);
  stoneTexBump.needsUpdate = true;

  const masonryMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: stoneTexColor,
    bumpMap: stoneTexBump,
    bumpScale: 0.14,
    roughness: 0.82,
    metalness: 0.08,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: '#1e3a6d',
    roughness: 0.45,
    metalness: 0.28,
  });
  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: '#d9a441',
    roughness: 0.24,
    metalness: 0.85,
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.woodColor,
    bumpMap: textures.woodBump,
    bumpScale: 0.08,
    roughness: 0.78,
    metalness: 0.05,
  });
  const bannerMat = new THREE.MeshStandardMaterial({
    color: '#b91c1c',
    roughness: 0.75,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  // 2. Cobblestone plaza slab at Solara Citadel courtyard (offset Y +0.04 to prevent Z-fighting)
  const plazaMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.cobbleColor,
    bumpMap: textures.cobbleBump,
    bumpScale: 0.1,
    roughness: 0.84,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  textures.cobbleColor.repeat.set(6, 6);
  textures.cobbleBump.repeat.set(6, 6);

  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 15.2, 0.28, 24), plazaMat);
  plaza.position.set(0, terrainHeightAt(0, -18) + 0.04, -18);
  plaza.receiveShadow = true;
  worldGroup.add(plaza);

  // 3. SOLARA CITADEL KEEP (hero landmark framed at spawn, at x=0, z=-22)
  const keepGroup = new THREE.Group();
  const keepBaseY = terrainHeightAt(0, -24);
  keepGroup.position.set(0, keepBaseY, -24);

  // Main fortified keep body
  const mainKeep = new THREE.Mesh(new THREE.BoxGeometry(12, 11.5, 9), masonryMat);
  mainKeep.position.y = 5.75;
  mainKeep.castShadow = true;
  mainKeep.receiveShadow = true;
  keepGroup.add(mainKeep);
  colliders.push({ x: 0, z: -24, radius: 6.4 });

  // Upper royal spire
  const upperKeep = new THREE.Mesh(new THREE.BoxGeometry(6.8, 6.2, 6.2), masonryMat);
  upperKeep.position.y = 14.4;
  upperKeep.castShadow = true;
  keepGroup.add(upperKeep);

  const centralRoof = new THREE.Mesh(new THREE.ConeGeometry(5.5, 5.2, 4), roofMat);
  centralRoof.position.y = 20.1;
  centralRoof.rotation.y = Math.PI / 4;
  centralRoof.castShadow = true;
  keepGroup.add(centralRoof);

  // Glowing Solara Spire Crystal atop the keep
  const spireCrystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.4, 0),
    new THREE.MeshStandardMaterial({
      color: '#fde047',
      emissive: '#f59e0b',
      emissiveIntensity: 1.2,
      roughness: 0.15,
      metalness: 0.2,
    })
  );
  spireCrystal.position.y = 24.4;
  keepGroup.add(spireCrystal);
  animatedCrystals.push(spireCrystal);

  const beaconLight = new THREE.PointLight('#fbbf24', 18, 42, 1.6);
  beaconLight.position.set(0, 14, -16);
  worldGroup.add(beaconLight);

  // 4 Corner Bastion Towers with conical roofs & gold finials
  const towerOffsets: Array<[number, number]> = [
    [-7.2, -5.2],
    [7.2, -5.2],
    [-7.2, 5.2],
    [7.2, 5.2],
  ];
  for (const [tx, tz] of towerOffsets) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.45, 13.5, 10), masonryMat);
    tower.position.set(tx, 6.75, tz);
    tower.castShadow = true;
    tower.receiveShadow = true;
    keepGroup.add(tower);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.35, 1.1, 10), goldTrimMat);
    collar.position.set(tx, 13.6, tz);
    keepGroup.add(collar);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.75, 4.6, 10), roofMat);
    cap.position.set(tx, 16.4, tz);
    cap.castShadow = true;
    keepGroup.add(cap);

    colliders.push({ x: tx, z: -24 + tz, radius: 2.5 });
  }

  // Gatehouse archway & timber doors framed by solid stone jambs
  const jambGeo = new THREE.BoxGeometry(1.5, 5.2, 2.4);
  const jambL = new THREE.Mesh(jambGeo, masonryMat);
  jambL.position.set(-2.6, 2.6, 4.8);
  const jambR = new THREE.Mesh(jambGeo, masonryMat);
  jambR.position.set(2.6, 2.6, 4.8);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.6, 2.6), masonryMat);
  lintel.position.set(0, 5.8, 4.8);
  const gateDoor = new THREE.Mesh(new THREE.BoxGeometry(3.7, 4.9, 0.5), woodMat);
  gateDoor.position.set(0, 2.45, 4.4);
  const gateCrest = new THREE.Mesh(new THREE.OctahedronGeometry(0.65, 0), goldTrimMat);
  gateCrest.position.set(0, 6.0, 6.2);
  keepGroup.add(jambL, jambR, lintel, gateDoor, gateCrest);

  // Heraldic Banners flanking the Citadel gate
  for (const side of [-1, 1]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.6), bannerMat);
    banner.position.set(side * 4.4, 7.6, 4.85);
    keepGroup.add(banner);
    banners.push(banner);
  }

  worldGroup.add(keepGroup);

  // 4. Regional Landmarks in the 3 outer biomes (every 30-45m)
  // 4a. Verdant High-Elf Shrine (NW: x = -40, z = -26)
  const shrinePos = new THREE.Vector3(-40, terrainHeightAt(-40, -26), -26);
  const shrineGroup = new THREE.Group();
  shrineGroup.position.copy(shrinePos);
  const shrineDais = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6.2, 0.9, 12), masonryMat);
  shrineDais.position.y = 0.45;
  shrineGroup.add(shrineDais);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 6.2, 8), masonryMat);
    pillar.position.set(Math.cos(ang) * 4.2, 3.6, Math.sin(ang) * 4.2);
    pillar.castShadow = true;
    shrineGroup.add(pillar);
  }
  const emeraldCrystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.35, 0),
    new THREE.MeshStandardMaterial({
      color: '#34d399',
      emissive: '#10b981',
      emissiveIntensity: 1.1,
      roughness: 0.15,
      metalness: 0.25,
    })
  );
  emeraldCrystal.position.y = 4.6;
  shrineGroup.add(emeraldCrystal);
  animatedCrystals.push(emeraldCrystal);
  worldGroup.add(shrineGroup);
  colliders.push({ x: -40, z: -26, radius: 3.4 });

  // 4b. Ironforge Runic Watchtower (NE: x = 42, z = -24)
  const forgePos = new THREE.Vector3(42, terrainHeightAt(42, -24), -24);
  const forgeGroup = new THREE.Group();
  forgeGroup.position.copy(forgePos);
  const forgeTower = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.3, 12, 8), masonryMat);
  forgeTower.position.y = 6;
  forgeTower.castShadow = true;
  const forgeRing = new THREE.Mesh(new THREE.TorusGeometry(4.0, 0.35, 6, 12), goldTrimMat);
  forgeRing.rotation.x = Math.PI / 2;
  forgeRing.position.y = 9.5;
  const brazier = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.3, 0),
    new THREE.MeshStandardMaterial({
      color: '#fb923c',
      emissive: '#ea580c',
      emissiveIntensity: 1.35,
      roughness: 0.2,
    })
  );
  brazier.position.y = 13.4;
  forgeGroup.add(forgeTower, forgeRing, brazier);
  animatedCrystals.push(brazier);
  worldGroup.add(forgeGroup);
  colliders.push({ x: 42, z: -24, radius: 4.3 });

  // 4c. Shadowvale Cursed Obelisk (South Boss Arena: x = 0, z = 48)
  const obeliskPos = new THREE.Vector3(0, terrainHeightAt(0, 48), 48);
  const obeliskGroup = new THREE.Group();
  obeliskGroup.position.copy(obeliskPos);
  const obeliskBase = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.4, 0.8, 8), masonryMat);
  obeliskBase.position.y = 0.4;
  const obeliskSpire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.65, 1.75, 13.5, 4),
    new THREE.MeshStandardMaterial({
      color: '#231936',
      roughness: 0.4,
      metalness: 0.65,
    })
  );
  obeliskSpire.position.y = 7.2;
  obeliskSpire.castShadow = true;
  const voidOrb = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.4, 0),
    new THREE.MeshStandardMaterial({
      color: '#c084fc',
      emissive: '#9333ea',
      emissiveIntensity: 1.3,
      roughness: 0.15,
    })
  );
  voidOrb.position.y = 15.2;
  obeliskGroup.add(obeliskBase, obeliskSpire, voidOrb);
  animatedCrystals.push(voidOrb);
  worldGroup.add(obeliskGroup);
  colliders.push({ x: 0, z: 48, radius: 2.8 });

  // 5. Instanced Pine Trees (Composite Trunk + Lower Crown + Upper Crown with tint & scale variation)
  const treeCoords: Array<[number, number, number]> = [];
  let seed = 4219;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 165; i++) {
    const angle = nextRand() * Math.PI * 2;
    const dist = 20 + nextRand() * 72;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    // Keep spawn road, citadel courtyard, and landmarks clear
    if (Math.hypot(x, z + 20) < 20) continue;
    if (Math.hypot(x, z - 12) < 11) continue;
    if (Math.abs(x) < 5.5 && z > -24 && z < 54) continue;
    if (Math.abs(z - 12) < 5 && Math.abs(x) < 42) continue;
    if (Math.hypot(x + 40, z + 26) < 11) continue;
    if (Math.hypot(x - 42, z + 24) < 11) continue;
    if (Math.hypot(x, z - 48) < 14) continue;

    treeCoords.push([x, terrainHeightAt(x, z), z]);
  }

  const count = treeCoords.length;
  const trunkInst = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.28, 0.44, 2.6, 6),
    woodMat,
    count
  );
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.04,
  });
  const crownLowInst = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 3.8, 7), foliageMat, count);
  const crownHighInst = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, 3.1, 7), foliageMat, count);

  trunkInst.castShadow = !isSoftwareGl;
  crownLowInst.castShadow = !isSoftwareGl;
  crownHighInst.castShadow = !isSoftwareGl;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  treeCoords.forEach(([tx, ty, tz], idx) => {
    const s = 0.85 + nextRand() * 0.42;
    const rotY = nextRand() * Math.PI * 2;
    const biome = getBiomeAt(tx, tz);

    dummy.position.set(tx, ty + 1.25 * s, tz);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(tx, ty + 3.6 * s, tz);
    dummy.updateMatrix();
    crownLowInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(tx, ty + 5.7 * s, tz);
    dummy.updateMatrix();
    crownHighInst.setMatrixAt(idx, dummy.matrix);

    if (biome === 'cursed_wastes') {
      tint.set('#47355d');
    } else if (biome === 'ironforge_crags') {
      tint.set('#5a6b3e');
    } else if (biome === 'verdant_forest') {
      tint.set('#1f6b43');
    } else {
      tint.set('#2e7d47');
    }
    tint.offsetHSL((nextRand() - 0.5) * 0.04, 0, (nextRand() - 0.5) * 0.08);
    crownLowInst.setColorAt(idx, tint);
    crownHighInst.setColorAt(idx, tint.clone().offsetHSL(0, 0, 0.06));

    if (idx % 2 === 0) {
      colliders.push({ x: tx, z: tz, radius: 0.7 * s });
    }
  });

  trunkInst.computeBoundingSphere();
  crownLowInst.computeBoundingSphere();
  crownHighInst.computeBoundingSphere();
  worldGroup.add(trunkInst, crownLowInst, crownHighInst);

  // 6. Instanced Boulders & Crag Rocks
  const rockCount = 58;
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.08,
  });
  const rockInst = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.3, 0), rockMat, rockCount);
  for (let i = 0; i < rockCount; i++) {
    const ang = nextRand() * Math.PI * 2;
    const dist = 24 + nextRand() * 68;
    const rx = Math.cos(ang) * dist;
    const rz = Math.sin(ang) * dist;
    if (Math.abs(rx) < 6 && rz > -24 && rz < 54) {
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      rockInst.setMatrixAt(i, dummy.matrix);
      continue;
    }
    const ry = terrainHeightAt(rx, rz);
    const sx = 0.7 + nextRand() * 1.4;
    const sy = 0.55 + nextRand() * 1.1;
    const sz = 0.7 + nextRand() * 1.4;
    dummy.position.set(rx, ry + sy * 0.5, rz);
    dummy.rotation.set(nextRand() * 0.4, nextRand() * Math.PI * 2, nextRand() * 0.4);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    rockInst.setMatrixAt(i, dummy.matrix);

    const biome = getBiomeAt(rx, rz);
    tint.set(biome === 'cursed_wastes' ? '#433852' : biome === 'ironforge_crags' ? '#7b6859' : '#6b7280');
    tint.offsetHSL(0, 0, (nextRand() - 0.5) * 0.08);
    rockInst.setColorAt(i, tint);
    colliders.push({ x: rx, z: rz, radius: Math.max(sx, sz) * 1.05 });
  }
  rockInst.computeBoundingSphere();
  worldGroup.add(rockInst);

  // 7. Lantern Braziers lining the Solara Avenue leading from Spawn to Citadel Gate
  const lanternPostGeo = new THREE.CylinderGeometry(0.12, 0.18, 3.2, 6);
  const lanternBulbMat = new THREE.MeshStandardMaterial({
    color: '#fef08a',
    emissive: '#f59e0b',
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  for (let z = 14; z >= -10; z -= 8) {
    for (const side of [-4.6, 4.6]) {
      const ly = terrainHeightAt(side, z);
      const post = new THREE.Mesh(lanternPostGeo, goldTrimMat);
      post.position.set(side, ly + 1.6, z);
      const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), lanternBulbMat);
      lamp.position.set(side, ly + 3.4, z);
      worldGroup.add(post, lamp);
    }
  }

  return {
    worldGroup,
    colliders,
    animatedCrystals,
    banners,
    beaconLight,
  };
}
