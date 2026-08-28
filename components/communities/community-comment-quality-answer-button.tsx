'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Award, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/notifications/client-toast';
import { backendJson } from '@/lib/utils/backend-api';

export function CommunityCommentQualityAnswerButton({
  communitySlug,
  postId,
  commentId,
  qualityAnswer,
  onChanged,
}: {
  communitySlug: string;
  postId: string;
  commentId: string;
  qualityAnswer: boolean;
  onChanged?: (value: { qualityAnswer: boolean; qualityAnswerAt: string | null }) => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const nextQualityAnswer = !qualityAnswer;

  const toggleQualityAnswer = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await backendJson<{
        qualityAnswer: boolean;
        qualityAnswerAt: string | null;
      }>(
        `/api/communities/${encodeURIComponent(communitySlug)}/posts/${encodeURIComponent(
          postId,
        )}/comments/${encodeURIComponent(commentId)}/quality-answer`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qualityAnswer: nextQualityAnswer }),
          timeoutMs: 20_000,
        },
      );
      onChanged?.({
        qualityAnswer: result.qualityAnswer,
        qualityAnswerAt: result.qualityAnswerAt,
      });
      toast.success(result.qualityAnswer ? '已设为优质解答' : '已取消优质解答');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新优质解答失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={qualityAnswer ? 'secondary' : 'ghost'}
      className="h-7 gap-1.5 rounded-lg px-2 text-xs"
      onClick={() => void toggleQualityAnswer()}
      disabled={saving}
    >
      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Award className="size-3.5" />}
      {qualityAnswer ? '取消优质' : '设为优质'}
    </Button>
  );
}
