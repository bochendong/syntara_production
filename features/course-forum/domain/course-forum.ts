export type CourseForumStatusFilter = 'all' | 'unresolved' | 'resolved';

export type CourseForumAuthor = {
  id: string;
  name: string;
  image: string | null;
  isTeacher: boolean;
  forumRole?: 'student' | 'teacher' | 'admin';
  forumRoleLabel?: '学生' | '老师' | '管理员';
};

export type CourseForumAttachmentItem = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  url: string;
  downloadUrl: string;
};

export type CourseForumPostSummary = {
  id: string;
  title: string;
  bodyPreview: string;
  bodyPreviewMarkdown?: string;
  source?: 'course' | 'community';
  community?: {
    id: string;
    slug: string;
    name: string;
    visibility: string;
  } | null;
  author: CourseForumAuthor;
  resolved: boolean;
  pinned: boolean;
  pinnedAt: string | null;
  isWelcome: boolean;
  answerCount: number;
  commentCount: number;
  attachmentCount: number;
  previewAttachments?: Array<Pick<CourseForumAttachmentItem, 'id' | 'fileName' | 'url' | 'downloadUrl'>>;
  tablePreview?: {
    headers: string[];
    rows: string[][];
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type CourseForumAnswerItem = {
  id: string;
  bodyMarkdown: string;
  author: CourseForumAuthor;
  accepted: boolean;
  acceptedAt: string | null;
  attachments: CourseForumAttachmentItem[];
  createdAt: string;
  updatedAt: string;
};

export type CourseForumCommentItem = {
  id: string;
  body: string;
  author: CourseForumAuthor;
  parentId: string | null;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CourseForumCommentPage = {
  hasMore: boolean;
  nextOffset: number;
  totalCount: number;
};

export type CourseForumPostDetail = CourseForumPostSummary & {
  bodyMarkdown: string;
  attachments: CourseForumAttachmentItem[];
  answers: CourseForumAnswerItem[];
  comments: CourseForumCommentItem[];
  commentsPage: CourseForumCommentPage;
};

export type CourseForumSnapshot = {
  course: {
    id: string;
    name: string;
    code: string;
    academicYear: number | null;
    term: 'winter' | 'summer' | 'fall' | null;
  };
  viewer: CourseForumAuthor & { accessRole: 'owner' | 'enrolled' };
  unresolvedCount: number;
  totalCount: number;
  pinnedPosts: CourseForumPostSummary[];
  posts: CourseForumPostSummary[];
  selectedPost: CourseForumPostDetail | null;
};
