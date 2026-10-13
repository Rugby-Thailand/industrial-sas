import { connection } from "next/server";
import { Fixture } from "../../../fixture";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ screen: string }>;
}) {
  await connection();
  const { screen } = await params;
  return <Fixture key={screen} screen={screen} />;
}
