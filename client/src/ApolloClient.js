import { ApolloClient, InMemoryCache } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";

const client = new ApolloClient({
    uri: "https://api.start.gg/gql/alpha",
    cache: new InMemoryCache(),
});

const authLink = setContext();

export default client;
