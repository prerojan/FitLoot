type RapidApiEnv = {
  RAPID_API_KEY?: string | undefined;
};

type ExerciseDbExercise = {
  id: string;
  name: string;
  bodyPart?: string | undefined;
  target?: string | undefined;
  secondaryMuscles?: string[] | undefined;
  instructions?: string[] | undefined;
};

type AscendExercise = {
  id?: string | undefined;
  gifUrl?: string | undefined;
  imageUrl?: string | undefined;
  instructions?: string[] | undefined;
  targetMuscles?: string[] | undefined;
  bodyParts?: string[] | undefined;
};

type AscendVideoExercise = {
  id?: string | undefined;
  videoUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  instructions?: string[] | undefined;
  muscles?: string[] | undefined;
};

export type EnrichedExercise = {
  id: string;
  name: string;
  bodyPart: string;
  target: string;
  secondaryMuscles: string[];
  instructions: string[];
  gifUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
};

async function rapidGet<T>(url: string, host: string, env: RapidApiEnv): Promise<T> {
  if (!env.RAPID_API_KEY) {
    throw new Error("rapidapi-key-missing");
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-RapidAPI-Key": env.RAPID_API_KEY,
      "X-RapidAPI-Host": host,
    },
  });

  if (!response.ok) {
    throw new Error(`rapidapi-request-failed:${host}:${response.status}`);
  }

  return (await response.json()) as T;
}

export async function searchExerciseDB(exerciseName: string, env: RapidApiEnv): Promise<ExerciseDbExercise[]> {
  const payload = await rapidGet<ExerciseDbExercise[]>(
    "https://exercisedb.p.rapidapi.com/exercises?limit=300",
    "exercisedb.p.rapidapi.com",
    env
  );

  const normalizedQuery = exerciseName.toLowerCase();
  return payload
    .filter((exercise) => exercise.name.toLowerCase().includes(normalizedQuery))
    .slice(0, 8);
}

export async function fetchExerciseMedia(exerciseId: string, env: RapidApiEnv): Promise<AscendExercise | null> {
  try {
    return await rapidGet<AscendExercise>(
      `https://ascendapi.p.rapidapi.com/exercises/${encodeURIComponent(exerciseId)}`,
      "ascendapi.p.rapidapi.com",
      env
    );
  } catch {
    return null;
  }
}

export async function fetchExerciseVideo(exerciseId: string, env: RapidApiEnv): Promise<AscendVideoExercise | null> {
  try {
    return await rapidGet<AscendVideoExercise>(
      `https://ascendapi-videos.p.rapidapi.com/exercises/${encodeURIComponent(exerciseId)}`,
      "ascendapi-videos.p.rapidapi.com",
      env
    );
  } catch {
    return null;
  }
}

export async function enrichExercise(exerciseName: string, env: RapidApiEnv): Promise<EnrichedExercise | null> {
  const exercises = await searchExerciseDB(exerciseName, env);
  if (exercises.length === 0) return null;

  const exercise = exercises[0];
  const media = await fetchExerciseMedia(exercise.id, env);
  const video = !media?.gifUrl ? await fetchExerciseVideo(exercise.id, env) : null;

  return {
    id: exercise.id,
    name: exercise.name,
    bodyPart: exercise.bodyPart ?? "full body",
    target: exercise.target ?? "full body",
    secondaryMuscles: Array.isArray(exercise.secondaryMuscles) ? exercise.secondaryMuscles : [],
    instructions: Array.isArray(exercise.instructions) ? exercise.instructions : [],
    gifUrl: media?.gifUrl ?? null,
    imageUrl: media?.imageUrl ?? null,
    videoUrl: video?.videoUrl ?? null,
    thumbnailUrl: video?.thumbnailUrl ?? null,
  };
}
