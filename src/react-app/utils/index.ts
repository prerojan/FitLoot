export function cn(...classes: Array<string | false | null | undefined>) {
  // Junta classes opcionais sem depender de uma biblioteca externa.
  return classes.filter(Boolean).join(' ');
}
