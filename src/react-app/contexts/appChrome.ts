import { createContext, useContext } from "react";

export interface AppChromeContextValue {
  missionDetailsOpen: boolean;
  missionExecutionOpen: boolean;
  setMissionDetailsOpen: (open: boolean) => void;
  setMissionExecutionOpen: (open: boolean) => void;
}

export const AppChromeContext = createContext<AppChromeContextValue>({
  missionDetailsOpen: false,
  missionExecutionOpen: false,
  setMissionDetailsOpen: () => {
    return undefined;
  },
  setMissionExecutionOpen: () => {
    return undefined;
  },
});

export const useAppChrome = () => useContext(AppChromeContext);
