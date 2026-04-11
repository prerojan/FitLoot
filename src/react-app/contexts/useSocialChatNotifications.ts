import { useContext } from "react";

import {
  SocialChatNotificationsContext,
  type SocialChatNotificationsContextValue,
} from "@/react-app/contexts/socialChatNotificationsContext";

export function useSocialChatNotifications(): SocialChatNotificationsContextValue {
  return useContext(SocialChatNotificationsContext);
}
