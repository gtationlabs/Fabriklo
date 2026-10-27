"use server";

import { revalidatePath } from "next/cache";
import { deleteJob } from "@/lib/tryon/service";

export async function deleteTryonJob(id: string) {
  await deleteJob(id);
  revalidatePath("/account/try-on");
}
