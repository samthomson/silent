import { DMMessagingInterface } from "@/components/dm/DMMessagingInterface";

export function Test() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">DM System Test Page</h1>
      <p className="text-muted-foreground">
        This page is wrapped in NewDMProvider. Add messaging UI components here to test the new DM system.
      </p>
			<hr />
			<DMMessagingInterface />
    </div>
  );
}

export default Test;

