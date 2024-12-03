import { useEffect } from "react";

async function FetchTournaments() {
    var res = await fetch("http://localhost:3001/GetInfo", {
        method: "GET",

        headers: {
            "Content-Type": "application/json",
        },
    });
    console.log(res);
    console.log(res.json());
}

export default function UserList() {
    useEffect(() => {
        FetchTournaments();
    });
    // const { error, data, loading } = useQuery(GET_USERS, {
    //     variables: { page: 1, perPage: 5 },
    // });

    // console.log({ error, loading, data });
    // if (loading) return <div>loading...</div>;
    // if (error) return <div>error</div>;

    // const list = [];
    // data.tournaments.nodes.forEach((tournament) => {
    //     if (tournament.events.length > 0) {
    //         tournament.events[0].entrants.nodes.forEach((entrant) => {
    //             entrant.participants.forEach((participant) => {
    //                 const tag = participant.player.gamerTag;
    //                 list.push(
    //                     <div key={tournament.id + participant.player.id}>
    //                         {tag + ": " + participant.player.id}
    //                     </div>
    //                 );
    //             });
    //         });
    //     }
    // });
    // return <div>{list}</div>;
}
