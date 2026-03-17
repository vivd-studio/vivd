import { QuestionDock } from "@/features/opencodeChat/questions/QuestionDock";
import { useChatContext } from "./ChatContext";
import { ChatComposer } from "./ChatComposer";

interface ChatInputRegionProps {
  composerClassName?: string;
}

export function ChatInputRegion({ composerClassName }: ChatInputRegionProps) {
  const {
    activeQuestionRequest,
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

  return <ChatComposer className={composerClassName} />;
}
