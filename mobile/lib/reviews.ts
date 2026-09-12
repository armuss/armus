import { supabase } from './supabase';

export type Review = {
  id: string;
  bookingId: string;
  teacherId: string;
  studentId: string;
  studentName: string;
  stars: number;
  text: string;
  createdAt: string;
};

function mapReviewRow(row: any): Review {
  return {
    id: row.id,
    bookingId: row.booking_id,
    teacherId: row.teacher_id,
    studentId: row.student_id,
    studentName: row.student_name,
    stars: row.stars,
    text: row.comment || '',
    createdAt: row.created_at,
  };
}

export async function getReviewForBooking(bookingId: string): Promise<Review | null> {
  const { data, error } = await supabase.from('reviews').select('*').eq('booking_id', bookingId).maybeSingle();

  if (error || !data) return null;
  return mapReviewRow(data);
}

export async function addReview(review: {
  bookingId: string;
  teacherId: string;
  studentId: string;
  studentName: string;
  stars: number;
  text: string;
}): Promise<Review | null> {
  const { data, error } = await supabase
    .from('reviews')
    .insert({
      booking_id: review.bookingId,
      teacher_id: review.teacherId,
      student_id: review.studentId,
      student_name: review.studentName,
      stars: review.stars,
      comment: review.text || null,
    })
    .select()
    .single();

  if (error) return null;
  return mapReviewRow(data);
}
