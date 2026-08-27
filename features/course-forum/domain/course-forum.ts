export type CourseForumStatusFilter = 'all' | 'unresolved' | 'resolved';

export type CourseForumAuthor = {
  id: string;
  name: string;
  image: string | null;
  isTeacher: boolean;
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
  author: CourseForumAuthor;
  resolved: boolean;
  pinned: boolean;
  pinnedAt: string | null;
  isWelcome: boolean;
  answerCount: number;
  commentCount: number;
  attachmentCount: number;
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
  createdAt: string;
  updatedAt: string;
};

export type CourseForumPostDetail = CourseForumPostSummary & {
  bodyMarkdown: string;
  attachments: CourseForumAttachmentItem[];
  answers: CourseForumAnswerItem[];
  comments: CourseForumCommentItem[];
};

export type CourseForumSnapshot = {
  course: {
    id: string;
    name: string;
    code: string;
    academicYear: number | null;
    term: 'winter' | 'summer' | 'fall' | null;
    problemCount: number;
  };
  viewer: CourseForumAuthor & { accessRole: 'owner' | 'enrolled' };
  unresolvedCount: number;
  totalCount: number;
  pinnedPosts: CourseForumPostSummary[];
  posts: CourseForumPostSummary[];
  selectedPost: CourseForumPostDetail | null;
};
