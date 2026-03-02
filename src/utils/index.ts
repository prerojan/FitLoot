// Utility function to create page URLs
export function createPageUrl(page: string): string {
  const routes: Record<string, string> = {
    'Home': '/app',
    'Onboarding': '/onboarding',
    'Dashboard': '/dashboard',
    'Profile': '/profile',
    'Shop': '/shop',
    'Ranking': '/ranking',
    'Friends': '/friends',
    'MiniGames': '/minigames'
  };
  
  return routes[page] || '/';
}
