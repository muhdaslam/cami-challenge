// Plain data the requests use cases work with. No framework or ORM imports live here or in
// the ports that use these types: how the data is stored is an adapter's business.

export type RequestStatus = 'open' | 'in_progress' | 'resolved';

export type RequestRecord = {
  id: string;
  message: string;
  status: RequestStatus;
  category: string | null;
  confidence: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NoteRecord = {
  id: string;
  body: string;
  authorName: string;
  requestId: string;
  createdAt: Date;
};

export type RequestWithNotes = RequestRecord & { notes: NoteRecord[] };

// One row of the requests table.
export type RequestListItem = {
  id: string;
  message: string;
  status: RequestStatus;
  category: string | null;
  confidence: number | null;
  noteCount: number;
  latestNotePreview: string | null;
  createdAt: string;
  updatedAt: string;
};
