import { useContext } from "react";

import {
  RewardNotificationsContext,
  type RewardNotificationsContextValue,
} from "@/react-app/contexts/rewardNotificationsContext";

export function useRewardNotifications(): RewardNotificationsContextValue {
  return useContext(RewardNotificationsContext);
}
