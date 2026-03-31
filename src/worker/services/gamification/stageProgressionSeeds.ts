import type { SkillStageSeed } from "../../core/types";

export const stageProgressionSeeds: SkillStageSeed[] = [
  [
    "Handstand",
    [
      "Quadruped Rocking",
      "Hollow Body",
      "Crow Pose",
      "Wall Walk",
      "How to Bail out of a Handstand",
      "Handstand completo",
    ],
  ],
  [
    "Front Lever",
    [
      "Scapula Pull",
      "Tuck Front Lever",
      "Advanced Tuck Lever",
      "One Leg Front Lever",
      "Straddle Front Lever",
      "Front Lever completo",
    ],
  ],
  [
    "Back Lever",
    [
      "Skin the Cat",
      "German Hang",
      "Tuck Back Lever",
      "Advanced Tuck Back Lever",
      "Straddle Back Lever",
      "Back Lever completo",
    ],
  ],
  [
    "Planche",
    [
      "Planche Lean",
      "Frog Stand",
      "Tuck Planche",
      "Advanced Tuck Planche",
      "Straddle Planche",
      "Planche completa",
    ],
  ],
  [
    "Human Flag",
    [
      "Side Plank",
      "Vertical Flag Hold",
      "Tuck Human Flag",
      "One Leg Flag",
      "Straddle Flag",
      "Human Flag completa",
    ],
  ],
  [
    "Muscle Up",
    [
      "Explosive Pull-up",
      "Chest to Bar",
      "Transition Drill",
      "Band Assisted Muscle Up",
      "Negative Muscle Up",
      "Muscle Up completo",
    ],
  ],
  [
    "Pistol Squat",
    [
      "Box Pistol",
      "Assisted Pistol",
      "Counterbalance Pistol",
      "Slow Eccentric Pistol",
      "Partial ROM Pistol",
      "Pistol Squat completo",
    ],
  ],
  [
    "Dragon Flag",
    [
      "Hollow Hold",
      "Reverse Crunch",
      "Dragon Flag Negativa",
      "Half Dragon Flag",
      "Strict Dragon Flag",
      "Dragon Flag completa",
    ],
  ],
  [
    "L-Sit",
    [
      "Seated Compression",
      "Tuck Sit",
      "One Leg L-Sit",
      "Alternating L-Sit",
      "V-Sit Prep",
      "L-Sit completo",
    ],
  ],
  [
    "Crow Pose",
    [
      "Core Engagement Basics",
      "Wrist Strengthening",
      "Squat Hold Balance",
      "Tripod Head Balance",
      "Crow Pose completo",
    ],
  ],
  [
    "Headstand",
    [
      "Neck and Shoulder Strengthening",
      "Dolphin Pose",
      "Supported Headstand (wall)",
      "Headstand Balance",
      "Freestanding Headstand",
    ],
  ],
  [
    "Wheel Pose",
    [
      "Bridge Prep",
      "Thoracic Mobility",
      "Wheel Assist",
      "Wheel Hold",
      "Wheel Pose completa",
    ],
  ],
  [
    "Firefly Pose",
    [
      "Hamstring Prep",
      "Arm Balance Prep",
      "Tuck Firefly",
      "Firefly Hold",
      "Firefly Pose completa",
    ],
  ],
  [
    "Eight Angle Pose",
    [
      "Twist Prep",
      "Leg Lock Drill",
      "Eight Angle Assisted",
      "Eight Angle Hold",
      "Eight Angle Pose completa",
    ],
  ],
  [
    "Scorpion Pose",
    [
      "Forearm Stand Prep",
      "Backbend Mobility",
      "Wall Scorpion",
      "Scorpion Balance",
      "Scorpion Pose completa",
    ],
  ],
].flatMap(([skillName, stages], skillIndex) =>
  (stages as string[]).map((name, stageIndex) => ({
    skillName: String(skillName),
    stageNumber: stageIndex + 1,
    name,
    description: `Progressão ${stageIndex + 1} de ${skillName}`,
    levelRequired: 4 + stageIndex * 2 + (skillIndex % 2),
    exerciseReference: name,
  })),
);
