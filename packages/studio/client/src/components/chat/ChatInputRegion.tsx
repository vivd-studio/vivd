import { QuestionDock } from "@/features/opencodeChat/questions/QuestionDock";
import { useChatContext } from "./ChatContext";
import { ChatComposer } from "./ChatComposer";
import { FollowupQueueDock } from "./FollowupQueueDock";

interface ChatInputRegionProps {
  composerClassName?: string;
}

export function ChatInputRegion({ composerClassName }: ChatInputRegionProps) {
  const {
    activeQuestionRequest,
    queuedFollowups,
    queuedFollowupSendingId,
    handleSendQueuedFollowup,
    handleEditQueuedFollowup,
    handleReplyQuestion,
    handleRejectQuestion,
  } = useChatContext();

  if (activeQuestionRequest) {
    return (
      <QuestionDock
        request={activeQuestionRequest}
        onReply={handleReplyQuestion}
        onReject={handleRejectQuestion}
      />
    );
  }

  return (
    <>
      {queuedFollowups.length > 0 ? (
        <FollowupQueueDock
          items={queuedFollowups}
          sendingId={queuedFollowupSendingId}
          onSend={handleSendQueuedFollowup}
          onEdit={handleEditQueuedFollowup}
        />
      ) : null}
      <ChatComposer className={composerClassName} />
    </>
  );
}
