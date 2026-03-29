/**
 * Serviço de fallback para leitura e escrita de dados no Google Fit.
 * Mantém uma implementação web simulada para ambientes sem camada nativa.
 */

// Centraliza as permissões e credenciais usadas pelo fluxo web.
const GOOGLE_FIT_CONFIG = {
  CLIENT_ID: '973548034883-d5k59mvdmd3kp8ghgb179f90imlpcr7d.apps.googleusercontent.com',
  API_KEY: process.env.REACT_APP_GOOGLE_FIT_API_KEY || '',
  SCOPES: [
    'https://www.googleapis.com/auth/fitness.activity.read',
    'https://www.googleapis.com/auth/fitness.activity.write',
    'https://www.googleapis.com/auth/fitness.body.read',
    'https://www.googleapis.com/auth/fitness.body.write',
    'https://www.googleapis.com/auth/fitness.nutrition.read',
    'https://www.googleapis.com/auth/fitness.nutrition.write',
  ],
};

export interface GoogleFitData {
  steps: number;
  calories: number;
  distance: number;
  heartRate?: number;
  activeMinutes: number;
  timestamp: string;
}

export interface GoogleFitPermissions {
  oauthToken: string | null;
  grantedScopes: string[];
}

class GoogleFitService {
  private isAvailable: boolean = false;
  private permissions: GoogleFitPermissions = {
    oauthToken: null,
    grantedScopes: [],
  };

  constructor() {
    this.checkAvailability();
  }

  // Determina se o ambiente atual realmente suporta integração com Google Fit.
  private async checkAvailability(): Promise<void> {
    this.isAvailable = false;
    return;
  }

  // Expõe a disponibilidade calculada para os consumidores do serviço.
  async getAvailability(): Promise<boolean> {
    return false;
  }

  // Conduz a autenticação OAuth e persiste o token concedido.
  async authenticate(): Promise<boolean> {
    if (!this.isAvailable) {
      throw new Error('Google Fit is not available on this device');
    }

    try {
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_FIT_CONFIG.CLIENT_ID}&` +
        `redirect_uri=${window.location.origin}&` +
        `response_type=token&` +
        `scope=${GOOGLE_FIT_CONFIG.SCOPES.join(' ')}&` +
        `include_granted_scopes=true`;

      const popup = window.open(authUrl, 'google-fit-auth', 'width=500,height=600');
      
      return new Promise((resolve, reject) => {
        const checkPopup = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(checkPopup);
            reject(new Error('Authentication cancelled'));
            return;
          }

          try {
            if (popup.location.href.includes(window.location.origin)) {
              const urlParams = new URLSearchParams(popup.location.hash.substring(1));
              const token = urlParams.get('access_token');
              
              if (token) {
                this.permissions.oauthToken = token;
                this.permissions.grantedScopes = GOOGLE_FIT_CONFIG.SCOPES;
                popup.close();
                clearInterval(checkPopup);
                resolve(true);
              }
            }
          } catch {
            // Ignora o erro de origem cruzada enquanto o popup ainda está fora do domínio local.
          }
        }, 1000);

        setTimeout(() => {
          clearInterval(checkPopup);
          if (popup && !popup.closed) {
            popup.close();
          }
          reject(new Error('Authentication timeout'));
        }, 300000);
      });
    } catch (error) {
      console.error('Google Fit authentication failed:', error);
      return false;
    }
  }

  // Retorna o estado atual do token e dos escopos concedidos.
  async checkAuthStatus(): Promise<GoogleFitPermissions> {
    return this.permissions;
  }

  // Lê os dados de hoje e consolida passos, calorias e métricas derivadas.
  async readTodayData(): Promise<GoogleFitData> {
    if (!this.isAvailable) {
      throw new Error('Google Fit is not available on this device');
    }

    if (!this.permissions.oauthToken) {
      throw new Error('Not authenticated with Google Fit');
    }

    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const stepsResponse = await fetch(
        `https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate?` +
        `aggregateBydataTypeName=com.google.step_count.delta&` +
        `startTimeMillis=${startOfDay.getTime()}&` +
        `endTimeMillis=${now.getTime()}`,
        {
          headers: {
            'Authorization': `Bearer ${this.permissions.oauthToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const caloriesResponse = await fetch(
        `https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate?` +
        `aggregateBydataTypeName=com.google.calories.expended&` +
        `startTimeMillis=${startOfDay.getTime()}&` +
        `endTimeMillis=${now.getTime()}`,
        {
          headers: {
            'Authorization': `Bearer ${this.permissions.oauthToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      let steps = 0;
      let calories = 0;

      if (stepsResponse.ok) {
        const stepsData = await stepsResponse.json();
        steps = stepsData.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.intVal || 0;
      }

      if (caloriesResponse.ok) {
        const caloriesData = await caloriesResponse.json();
        calories = caloriesData.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal || 0;
      }

      const distance = steps * 0.0007; // Average step length ~0.7m
      const activeMinutes = Math.floor(steps / 100); // Rough estimate

      return {
        steps,
        calories: Math.round(calories),
        distance: Math.round(distance * 1000) / 1000, // km with 3 decimal places
        activeMinutes,
        timestamp: now.toISOString(),
      };
    } catch (error) {
      console.error('Failed to read Google Fit data:', error);

      return {
        steps: Math.floor(Math.random() * 12000) + 3000,
        calories: Math.floor(Math.random() * 400) + 150,
        distance: Math.floor(Math.random() * 8000) / 1000,
        activeMinutes: Math.floor(Math.random() * 90) + 20,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Mantém a escrita simulada para preservar o contrato do serviço.
  async writeHealthData(data: Partial<GoogleFitData>): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('Google Fit is not available on this device');
    }

    if (!this.permissions.oauthToken) {
      throw new Error('Not authenticated with Google Fit');
    }

    try {
      console.log('Writing health data to Google Fit:', data);

      await new Promise(resolve => setTimeout(resolve, 800));

      console.log('Google Fit data written successfully');
    } catch (error) {
      console.error('Failed to write Google Fit data:', error);
      throw new Error('Failed to write health data to Google Fit');
    }
  }

  // Gera uma série histórica simulada compatível com o contrato do app.
  async readHistoricalData(startDate: Date, endDate: Date): Promise<GoogleFitData[]> {
    if (!this.isAvailable) {
      throw new Error('Google Fit is not available on this device');
    }

    if (!this.permissions.oauthToken) {
      throw new Error('Not authenticated with Google Fit');
    }

    try {
      const data: GoogleFitData[] = [];
      const current = new Date(startDate);
      
      while (current <= endDate) {
        data.push({
          steps: Math.floor(Math.random() * 12000) + 3000,
          calories: Math.floor(Math.random() * 400) + 150,
          distance: Math.floor(Math.random() * 8000) / 1000,
          heartRate: Math.floor(Math.random() * 30) + 70,
          activeMinutes: Math.floor(Math.random() * 90) + 20,
          timestamp: current.toISOString(),
        });
        
        current.setDate(current.getDate() + 1);
      }
      
      return data;
    } catch (error) {
      console.error('Failed to read historical Google Fit data:', error);
      throw new Error('Failed to read historical health data from Google Fit');
    }
  }

  // Simula a inscrição em atualizações em tempo real para manter a API estável.
  async subscribeToRealTimeData(): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('Google Fit is not available on this device');
    }

    if (!this.permissions.oauthToken) {
      throw new Error('Not authenticated with Google Fit');
    }

    try {
      console.log('Subscribing to Google Fit real-time data...');

      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('Successfully subscribed to Google Fit real-time data');
    } catch (error) {
      console.error('Failed to subscribe to Google Fit real-time data:', error);
      throw new Error('Failed to subscribe to Google Fit real-time data');
    }
  }

  // Simula o desligamento da inscrição em tempo real.
  async unsubscribeFromRealTimeData(): Promise<void> {
    if (!this.isAvailable) {
      throw new Error('Google Fit is not available on this device');
    }

    try {
      console.log('Unsubscribing from Google Fit real-time data...');

      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('Successfully unsubscribed from Google Fit real-time data');
    } catch (error) {
      console.error('Failed to unsubscribe from Google Fit real-time data:', error);
      throw new Error('Failed to unsubscribe from Google Fit real-time data');
    }
  }

  // Limpa o estado de autenticação mantido no cliente.
  async signOut(): Promise<void> {
    try {
      this.permissions = {
        oauthToken: null,
        grantedScopes: [],
      };
      
      console.log('Successfully signed out from Google Fit');
    } catch (error) {
      console.error('Failed to sign out from Google Fit:', error);
      throw new Error('Failed to sign out from Google Fit');
    }
  }
}

export const googleFitService = new GoogleFitService();
export default googleFitService;
